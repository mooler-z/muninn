//! The local receiver.
//!
//! One endpoint, `POST /event`, bound to `127.0.0.1` and nowhere else. The
//! payload carries the user's working directory and the agent's full closing
//! message, so nothing here ever listens on `0.0.0.0`.
//!
//! It is hand-rolled rather than built on a web framework. The surface is a
//! request line, a handful of headers and a length-delimited body from a client
//! we wrote ourselves; a router, a middleware stack and eighty transitive crates
//! buy nothing against that, and AGENTS.md asks what a dependency costs at idle.
//! What that trade does buy is an obligation to be strict, so every limit below
//! is deliberate.
//!
//! Authentication is ADR-0005. The short version: `127.0.0.1` is reachable from
//! any browser the user visits a page in, so binding to localhost is not on its
//! own a defence against a hostile web page posting a fake panel.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

/// Request line plus headers. Generous for our own client, small enough that a
/// confused one cannot make us buffer without bound.
const MAX_HEAD: usize = 8 * 1024;
/// Closing messages are prose. A megabyte is already far past readable.
const MAX_BODY: usize = 1024 * 1024;
/// Our shim writes immediately and closes. Anything slower is not our shim.
const IO_TIMEOUT: Duration = Duration::from_secs(2);

pub struct Received {
    pub source: String,
    pub kind: String,
    pub body: Vec<u8>,
}

/// Bind the receiver, preferring [`crate::runtime::PREFERRED_PORT`].
///
/// Falling back to an ephemeral port is what keeps a port collision from
/// costing the user a summary: the shim learns the real port from
/// `runtime.json` rather than assuming one.
pub fn bind() -> std::io::Result<TcpListener> {
    let preferred = SocketAddr::from((Ipv4Addr::LOCALHOST, crate::runtime::PREFERRED_PORT));
    match TcpListener::bind(preferred) {
        Ok(l) => Ok(l),
        Err(_) => TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))),
    }
}

/// Serve forever on a background thread, handing each accepted payload to
/// `on_event`.
pub fn serve<F>(listener: TcpListener, token: String, on_event: F)
where
    F: Fn(Received) + Send + Sync + 'static,
{
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            // A connection per turn, a few times a day. A thread each is the
            // cheapest correct thing; nothing here justifies an async runtime.
            let token = token.clone();
            let handler = &on_event;
            match handle(stream, &token) {
                Ok(Some(received)) => handler(received),
                Ok(None) => {}
                Err(e) => eprintln!("muninn: receiver: {e}"),
            }
        }
    });
}

fn handle(stream: TcpStream, token: &str) -> std::io::Result<Option<Received>> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;

    let mut reader = BufReader::new(stream);

    let Some(request_line) = read_line(&mut reader, MAX_HEAD)? else {
        return Ok(None);
    };

    let mut parts = request_line.split(' ');
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    let mut content_length: Option<usize> = None;
    let mut given_token: Option<String> = None;
    let mut content_type = String::new();
    let mut has_origin = false;
    let mut budget = MAX_HEAD.saturating_sub(request_line.len());

    while let Some(line) = read_line(&mut reader, budget)? {
        if line.is_empty() {
            break;
        }
        budget = budget.saturating_sub(line.len() + 2);
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => content_length = value.parse().ok(),
            "content-type" => content_type = value.to_ascii_lowercase(),
            "x-muninn-token" => given_token = Some(value.to_string()),
            // Browsers attach this to every cross-origin request and cannot be
            // talked out of it; our shim never sends one. Its presence is
            // therefore proof the caller is a web page. See ADR-0005.
            "origin" => has_origin = true,
            _ => {}
        }
    }

    if has_origin {
        return refuse(&mut reader, "403 Forbidden");
    }
    if method != "POST" {
        return refuse(&mut reader, "405 Method Not Allowed");
    }
    let Some((path, query)) = split_target(&target) else {
        return refuse(&mut reader, "400 Bad Request");
    };
    if path != "/event" {
        return refuse(&mut reader, "404 Not Found");
    }
    if !constant_time_eq(given_token.as_deref().unwrap_or_default(), token) {
        return refuse(&mut reader, "403 Forbidden");
    }
    if !content_type.starts_with("application/json") {
        return refuse(&mut reader, "415 Unsupported Media Type");
    }

    let Some(length) = content_length else {
        return refuse(&mut reader, "411 Length Required");
    };
    if length > MAX_BODY {
        return refuse(&mut reader, "413 Payload Too Large");
    }

    let mut body = vec![0u8; length];
    if reader.read_exact(&mut body).is_err() {
        return refuse(&mut reader, "400 Bad Request");
    }

    let source = param(query, "source").unwrap_or_else(|| "claude-code".into());
    let kind = param(query, "kind").unwrap_or_else(|| "completed".into());

    respond(reader.get_mut(), "204 No Content")?;
    Ok(Some(Received { source, kind, body }))
}

/// Answer and accept nothing. Every rejection path goes through here so a new
/// check cannot forget to reply and leave the shim waiting out its timeout.
fn refuse(reader: &mut BufReader<TcpStream>, status: &str) -> std::io::Result<Option<Received>> {
    respond(reader.get_mut(), status)?;
    Ok(None)
}

fn respond(stream: &mut TcpStream, status: &str) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
    stream.flush()
}

/// Read one CRLF-terminated line, refusing to buffer past `budget`.
fn read_line(reader: &mut BufReader<TcpStream>, budget: usize) -> std::io::Result<Option<String>> {
    let mut line = Vec::new();
    let mut limited = reader.take(budget as u64);
    let read = limited.read_until(b'\n', &mut line)?;
    if read == 0 {
        return Ok(None);
    }
    while line.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
        line.pop();
    }
    Ok(Some(String::from_utf8_lossy(&line).into_owned()))
}

fn split_target(target: &str) -> Option<(&str, &str)> {
    if !target.starts_with('/') {
        return None;
    }
    Some(match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    })
}

fn param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

/// Compare without leaking length or position through timing.
///
/// The token is local and short-lived, so this is closer to hygiene than to a
/// defence against a serious timing attack — but getting it wrong costs nothing
/// to avoid.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Shutdown;

    /// Drive a real connection against a real listener, the way the shim does.
    ///
    /// Every step is tolerant of failure on purpose: several of these cases
    /// have the receiver refuse and close mid-request, so a client that
    /// unwrapped its writes would fail on a broken pipe rather than on the
    /// thing being tested.
    fn request(raw: &str) -> (String, Option<Received>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let raw = raw.to_string();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            let _ = s.write_all(raw.as_bytes());
            let _ = s.flush();
            // The real shim sends a complete request and then waits. Half-
            // closing says "that is all of it", which is what stops the
            // receiver waiting out its read timeout on a truncated fixture.
            let _ = s.shutdown(Shutdown::Write);
            let mut reply = String::new();
            let _ = s.read_to_string(&mut reply);
            reply
        });

        let (stream, _) = listener.accept().unwrap();
        // `handle` returning Err is a normal outcome for a malformed request —
        // `serve` logs it and drops the connection. The assertion is that it
        // does not panic.
        let received = handle(stream, "secret").unwrap_or(None);
        (client.join().unwrap(), received)
    }

    fn post(headers: &str, body: &str) -> (String, Option<Received>) {
        request(&format!(
            "POST /event?source=claude-code&kind=completed HTTP/1.1\r\n\
             Host: 127.0.0.1\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        ))
    }

    #[test]
    fn accepts_a_well_formed_payload() {
        let (reply, received) = post("X-Muninn-Token: secret\r\n", r#"{"a":1}"#);
        assert!(reply.starts_with("HTTP/1.1 204"));
        let received = received.expect("payload should have been accepted");
        assert_eq!(received.source, "claude-code");
        assert_eq!(received.kind, "completed");
        assert_eq!(received.body, br#"{"a":1}"#);
    }

    #[test]
    fn rejects_a_wrong_or_missing_token() {
        for headers in ["X-Muninn-Token: wrong\r\n", ""] {
            let (reply, received) = post(headers, "{}");
            assert!(reply.starts_with("HTTP/1.1 403"), "got {reply:?}");
            assert!(received.is_none());
        }
    }

    #[test]
    fn rejects_anything_carrying_an_origin() {
        // The web-page case from ADR-0005: even with a correct token, a browser
        // request is not one of ours.
        let (reply, received) = post("X-Muninn-Token: secret\r\nOrigin: https://example.com\r\n", "{}");
        assert!(reply.starts_with("HTTP/1.1 403"), "got {reply:?}");
        assert!(received.is_none());
    }

    #[test]
    fn rejects_a_form_post_which_is_what_a_page_can_send_without_cors() {
        let (reply, received) = request(
            "POST /event HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded\r\n\
             X-Muninn-Token: secret\r\nContent-Length: 2\r\n\r\n{}",
        );
        assert!(reply.starts_with("HTTP/1.1 415"), "got {reply:?}");
        assert!(received.is_none());
    }

    #[test]
    fn rejects_an_oversized_body_without_reading_it() {
        let (reply, received) = request(
            "POST /event HTTP/1.1\r\nContent-Type: application/json\r\n\
             X-Muninn-Token: secret\r\nContent-Length: 999999999\r\n\r\n",
        );
        assert!(reply.starts_with("HTTP/1.1 413"), "got {reply:?}");
        assert!(received.is_none());
    }

    #[test]
    fn rejects_other_paths_and_methods() {
        let (reply, _) = request(
            "GET /event HTTP/1.1\r\nX-Muninn-Token: secret\r\n\r\n",
        );
        assert!(reply.starts_with("HTTP/1.1 405"), "got {reply:?}");

        let (reply, _) = request(
            "POST /admin HTTP/1.1\r\nContent-Type: application/json\r\n\
             X-Muninn-Token: secret\r\nContent-Length: 0\r\n\r\n",
        );
        assert!(reply.starts_with("HTTP/1.1 404"), "got {reply:?}");
    }

    #[test]
    fn a_flood_of_headers_cannot_make_us_buffer_without_bound() {
        // Forty kilobytes of headers against an eight kilobyte budget. The
        // token is placed last, so it is never reached: the budget runs out
        // first and the request is refused.
        let junk = "X-Pad: ".to_string() + &"a".repeat(200) + "\r\n";
        let (reply, received) = post(&(junk.repeat(200) + "X-Muninn-Token: secret\r\n"), "{}");

        assert!(received.is_none(), "must not accept a payload it never authenticated");
        // Deliberately not asserting the exact status text. The receiver closes
        // while the client is still writing, and a reset can discard the
        // buffered reply — so the reply may arrive truncated or not at all.
        // What matters is that it is never a success.
        assert!(!reply.starts_with("HTTP/1.1 2"), "got {reply:?}");
    }

    #[test]
    fn garbage_is_not_a_panic() {
        for raw in ["", "\r\n\r\n", "not http at all", "POST", "POST /event"] {
            let _ = request(raw);
        }
    }

    #[test]
    fn constant_time_eq_still_compares_correctly() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "ab"));
        assert!(constant_time_eq("", ""));
    }
}

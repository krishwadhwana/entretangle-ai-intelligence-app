// Tiny client-side SSE-over-POST reader. Our streaming persona endpoints emit
// `delta` frames (partial reply prose) followed by one `done` frame (the full
// JSON payload the non-streaming path would have returned), or an `error`
// frame. This streams deltas to `onDelta` and resolves with the `done` payload.
//
// On any transport / non-stream error it THROWS the server's error payload
// (same shape the JSON path returns), so callers can keep formatting it with
// providerErrorMessage exactly as before.
export async function postSSE<T>(
  url: string,
  body: unknown,
  onDelta: (content: string) => void
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // A validation / not-found error short-circuits to plain JSON, never SSE.
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw (data as { error?: unknown }).error ?? data;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: T | null = null;
  let errored: unknown = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    if (!data) return;
    const parsed = JSON.parse(data);
    if (event === "delta") onDelta((parsed as { content?: string }).content ?? "");
    else if (event === "done") done = parsed as T;
    else if (event === "error") errored = parsed;
  };

  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (errored !== null) throw errored;
  if (done === null) throw new Error("stream ended without a result");
  return done;
}

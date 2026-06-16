import { useEffect, useRef, useState } from "react";
import api from "../services/api";

export default function AIChatDrawer({ reportId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.get("/ai-chat/history")
      .then(({ data }) => setMessages(data.slice().reverse().map((item) => ({ id: item.id, query: item.query, reply: item.reply }))))
      .catch(() => setMessages([]));
  }, [open]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);

  const send = async (event) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || loading) return;
    setQuery("");
    setLoading(true);
    try {
      const { data } = await api.post("/ai-chat", { query: text, reportId });
      setMessages((current) => [...current, { query: text, reply: data.reply }]);
    } catch (error) {
      setMessages((current) => [...current, { query: text, reply: error.response?.data?.detail || "I could not answer that question right now." }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    await api.delete("/ai-chat/history/clear");
    setMessages([]);
  };

  return (
    <>
      <button className="ai-launcher" onClick={() => setOpen(true)}>Ask AI</button>
      {open && <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="Close AI assistant" />}
      <aside className={`ai-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">Report assistant</p>
            <h2>Ask your data</h2>
          </div>
          <div>
            {messages.length > 0 && <button className="btn-text" onClick={clear}>Clear</button>}
            <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
        </div>
        <div className="chat-context">{reportId ? `Using report ${reportId}` : "Select a report for data-aware answers"}</div>
        <div className="chat-messages">
          {!messages.length && (
            <div className="chat-welcome">
              <strong>Try asking</strong>
              <button onClick={() => setQuery("Which job status needs the most attention?")}>Which status needs attention?</button>
              <button onClick={() => setQuery("Summarize the report performance")}>Summarize performance</button>
            </div>
          )}
          {messages.map((message, index) => (
            <div className="chat-pair" key={message.id || index}>
              <p className="chat-user">{message.query}</p>
              <p className="chat-assistant">{message.reply}</p>
            </div>
          ))}
          {loading && <p className="chat-assistant chat-loading">Reviewing the report...</p>}
          <span ref={endRef} />
        </div>
        <form className="chat-form" onSubmit={send}>
          <textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about jobs, clients, status or performance..." rows={2} />
          <button disabled={!query.trim() || loading}>Send</button>
        </form>
      </aside>
    </>
  );
}

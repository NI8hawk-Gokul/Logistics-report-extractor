import { useEffect, useState } from "react";
import api from "../services/api";

function EmailShareModal({ isOpen, onClose, onSuccess, filters }) {
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("Logistics Report Extract");
  const [message, setMessage] = useState("Please find the extracted sub-report files attached.");
  const [attachmentType, setAttachmentType] = useState("pdf");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setErrorMessage("");
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!toEmail) {
      setErrorMessage("Please provide a receiver email address.");
      return;
    }
    setErrorMessage("");
    setSending(true);
    try {
      await api.post(`/share-report-email`, {
        toEmail,
        subject,
        message,
        attachmentType,
        filters
      });
      setToEmail("");
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || "Failed to share the report by email.");
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Secure delivery</p>
            <h3 id="share-report-title">Share report by email</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">x</button>
        </div>
        
        <div className="form-stack">
          {errorMessage && <div className="inline-alert error">{errorMessage}</div>}
          <div className="field-group">
            <label htmlFor="share-email">Receiver email</label>
            <input
              id="share-email"
              type="email"
              placeholder="manager@example.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field-group">
            <label htmlFor="share-subject">Email subject</label>
            <input
              id="share-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label htmlFor="share-message">Message</label>
            <textarea
              id="share-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label htmlFor="share-format">Attachment format</label>
            <select
              id="share-format"
              value={attachmentType}
              onChange={(e) => setAttachmentType(e.target.value)}
            >
              <option value="excel">Excel Spreadsheet (.xlsx)</option>
              <option value="pdf">PDF Report (.pdf)</option>
              <option value="both">Both PDF and Excel</option>
            </select>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSend} disabled={sending}>
            {sending ? "Sending Email..." : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmailShareModal;

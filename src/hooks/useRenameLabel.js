import { useState } from "react";

export function useRenameLabel(renameSheet) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  function startEditing(id, currentName) {
    setEditingId(id);
    setDraft(currentName);
  }

  function commitEditing() {
    if (editingId) renameSheet(editingId, draft);
    setEditingId(null);
  }

  return { editingId, draft, setDraft, startEditing, commitEditing };
}

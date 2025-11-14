export const ATTACHMENT_ID_KEYS = [
  'attachment_id',
  'id',
  'uuid',
  'file_id',
  'attachmentId',
  'attachmentID',
];

export const toAttachmentId = (attachment) => {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  for (const key of ATTACHMENT_ID_KEYS) {
    if (attachment[key] !== undefined && attachment[key] !== null) {
      return attachment[key];
    }
  }
  return null;
};

export const toAttachmentKey = (attachment) => {
  const id = toAttachmentId(attachment);
  if (id === null || id === undefined) {
    return `tmp:${JSON.stringify(attachment)}`;
  }
  return `id:${String(id)}`;
};

export const mergeAttachmentLists = (current = [], incoming = []) => {
  const map = new Map();
  const append = (attachment) => {
    if (!attachment || typeof attachment !== 'object') {
      return;
    }
    const key = toAttachmentKey(attachment);
    const existing = map.get(key);
    map.set(
      key,
      existing ? { ...existing, ...attachment } : { ...attachment }
    );
  };
  (Array.isArray(current) ? current : []).forEach(append);
  (Array.isArray(incoming) ? incoming : []).forEach(append);
  return Array.from(map.values());
};

export const normalizeAttachments = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const fromArray = Array.isArray(raw.attachments) ? raw.attachments : [];
  const single = raw.attachment
    ? Array.isArray(raw.attachment)
      ? raw.attachment
      : [raw.attachment]
    : [];
  return mergeAttachmentLists(fromArray, single);
};

export const normalizeMessageRecord = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const messageId =
    raw.message_id ??
    raw.id ??
    raw.uuid ??
    raw.messageId ??
    raw.local_id ??
    null;

  return {
    ...raw,
    message_id: messageId,
    attachments: normalizeAttachments(raw),
  };
};

export const mergeMessageRecords = (current, incoming) => {
  if (!current && !incoming) {
    return null;
  }
  if (!current) {
    return {
      ...incoming,
      attachments: mergeAttachmentLists([], incoming?.attachments),
    };
  }
  if (!incoming) {
    return {
      ...current,
      attachments: mergeAttachmentLists(current.attachments, []),
    };
  }
  return {
    ...current,
    ...incoming,
    attachments: mergeAttachmentLists(current.attachments, incoming.attachments),
  };
};

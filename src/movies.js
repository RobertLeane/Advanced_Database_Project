export function parseLines(value) {
  return [...new Set(String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

export function movieFields({ title, actors, genres }) {
  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle) throw new Error('Give your movie a title.');
  return { title: trimmedTitle, actors: parseLines(actors), genres: parseLines(genres) };
}

export function editableDocument(document) {
  const result = { ...document };
  for (const field of ['_conflicts', '_deleted_conflicts', '_revisions', '_revs_info', '_local_seq']) {
    delete result[field];
  }
  return result;
}

export function buildMovie(base, input, id = `movie:${crypto.randomUUID()}`) {
  return { ...editableDocument(base || { _id: id }), ...movieFields(input) };
}

export function isMovie(doc) {
  return Boolean(doc && !doc._id.startsWith('_') && !doc._deleted && typeof doc.title === 'string');
}

export function revisionSet(doc) {
  return [doc._rev, ...(doc._conflicts || [])].sort().join('|');
}

export class StaleDocumentError extends Error {
  constructor(latest) {
    super(latest ? 'This movie changed while you were editing. Your draft is still here; review the latest version before saving.' : 'This movie was deleted. Your draft is still here; you can save it as a new movie.');
    this.name = 'StaleDocumentError';
    this.latest = latest;
  }
}

export class MovieStore {
  constructor(db) { this.db = db; }

  async list() {
    const result = await this.db.allDocs({ include_docs: true, conflicts: true });
    return result.rows.map((row) => row.doc).filter(isMovie).sort((a, b) => a.title.localeCompare(b.title) || a._id.localeCompare(b._id));
  }

  async get(id) {
    try { return await this.db.get(id, { conflicts: true }); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }

  async save(base, input) {
    if (base) {
      const latest = await this.get(base._id);
      if (!latest || latest._rev !== base._rev || latest._conflicts?.length) throw new StaleDocumentError(latest);
    }
    const doc = buildMovie(base, input);
    try {
      const result = await this.db.put(doc);
      return { ...doc, _rev: result.rev };
    } catch (error) {
      if (error.status === 409) throw new StaleDocumentError(await this.get(doc._id));
      throw error;
    }
  }

  async remove(base) {
    const latest = await this.get(base._id);
    if (!latest || latest._rev !== base._rev || latest._conflicts?.length) throw new StaleDocumentError(latest);
    try { await this.db.remove(base._id, base._rev); }
    catch (error) {
      if (error.status === 409) throw new StaleDocumentError(await this.get(base._id));
      throw error;
    }
  }

  async conflictSnapshot(id) {
    const winner = await this.get(id);
    if (!winner) throw new Error('This movie has been deleted.');
    const revisions = [winner._rev, ...(winner._conflicts || [])];
    const versions = await Promise.all(revisions.map((rev) => this.db.get(id, { rev, attachments: true })));
    return { winner, versions, signature: revisionSet(winner) };
  }

  async resolve(snapshot, chosenVersion, input) {
    const current = await this.get(snapshot.winner._id);
    if (!current || revisionSet(current) !== snapshot.signature) throw new StaleDocumentError(current);
    if (!snapshot.versions.some((version) => version._rev === chosenVersion._rev)) throw new Error('Choose one of the displayed versions.');
    // Retain the chosen version's extra fields, but extend the current winning branch.
    const merged = buildMovie({ ...chosenVersion, _id: current._id, _rev: current._rev }, input);
    let saved;
    try { saved = await this.db.put(merged); }
    catch (error) {
      if (error.status === 409) throw new StaleDocumentError(await this.get(current._id));
      throw error;
    }
    // Never delete new conflict branches that were not part of the user's review.
    const afterSave = await this.get(current._id);
    const reviewedLosers = current._conflicts || [];
    if (!afterSave || afterSave._rev !== saved.rev || (afterSave._conflicts || []).some((rev) => !reviewedLosers.includes(rev))) {
      throw new Error('Your resolution was saved, but another edit arrived. Reload the versions and review the remaining conflict.');
    }
    const results = reviewedLosers.length ? await this.db.bulkDocs(reviewedLosers.map((rev) => ({ _id: current._id, _rev: rev, _deleted: true }))) : [];
    const latest = await this.get(current._id);
    if (results.some((result) => result.error) || !latest || latest._conflicts?.length || latest._rev !== saved.rev) {
      throw new Error('Your resolution was saved, but cleanup was incomplete or another edit arrived. Reload the versions and review again.');
    }
    return latest;
  }
}

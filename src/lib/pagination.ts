export async function collectPages<T>(
  loadPage: (offset: number, pageSize: number) => Promise<T[]>,
  pageSize = 500
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error("Sidstorleken måste vara ett positivt heltal.");
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await loadPage(offset, pageSize);
    if (page.length > pageSize) throw new Error("Datakällan returnerade fler rader än den begärda sidstorleken.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

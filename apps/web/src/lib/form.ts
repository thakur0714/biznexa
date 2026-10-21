export function formText(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === 'string' ? v : '';
}

// A datetime-local value ("YYYY-MM-DDTHH:mm") with the phone's UTC offset on that day appended.
export function withOffset(local: string) {
  const minutes = -new Date(local).getTimezoneOffset();
  const abs = Math.abs(minutes);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${local}${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

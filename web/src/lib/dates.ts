// Las fechas del API vienen en UTC; se muestran en la hora de Perú, sin depender del equipo.
const dateFormatter = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "long",
  timeZone: "America/Lima",
});

export function formatDate(isoDate: string): string {
  return dateFormatter.format(new Date(isoDate));
}

const dateTimeFormatter = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Lima",
});

/** Fecha y hora; la hora y su «a. m.» o «p. m.» no se parten en dos líneas en pantallas angostas. */
export function formatDateTime(isoDate: string): string {
  return dateTimeFormatter
    .format(new Date(isoDate))
    .replace(/\s([ap]\.)\s(m\.)/, " $1 $2");
}

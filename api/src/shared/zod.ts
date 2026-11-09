import { z } from "zod";

// Mensajes de validación en español para las respuestas 400.
z.config(z.locales.es());

export { z };

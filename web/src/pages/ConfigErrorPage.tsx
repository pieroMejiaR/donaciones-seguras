import { PageHeading } from "../components/PageHeading";

/** Se muestra cuando faltan variables de entorno; solo nombra las variables, no sus valores. */
export function ConfigErrorPage({ invalid }: { invalid: string[] }) {
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <PageHeading title="Falta configurar la aplicación" />
      <div role="alert" className="space-y-2">
        <p>Estas variables de entorno faltan o no son válidas:</p>
        <ul className="list-disc pl-6 font-mono text-sm break-all">
          {invalid.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
      <p className="text-muted">
        Copia <code className="break-all">web/.env.example</code> como{" "}
        <code className="break-all">web/.env.local</code>, completa los valores y reinicia el
        servidor.
      </p>
    </main>
  );
}

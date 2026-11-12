/** Error de carga con reintento. No muestra códigos ni detalles técnicos del API. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => unknown }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-danger bg-danger-soft p-4">
      <p className="font-medium text-danger">{message}</p>
      <button type="button" className="btn btn-secondary" onClick={() => void onRetry()}>
        Reintentar
      </button>
    </div>
  );
}

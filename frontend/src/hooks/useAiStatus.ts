import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AiStatus } from '../api/types';

/** Consulta uma vez se a assistência por IA está configurada no backend. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus({ enabled: false, provider: 'indisponível' }));
  }, []);

  return status;
}

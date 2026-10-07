import { useEffect, useState } from 'react';

/** Atrasa a propagação do valor — evita uma requisição por tecla digitada. */
export function useDebounce<T>(value: T, delay = 450): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

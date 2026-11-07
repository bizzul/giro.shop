import { useRef, useState } from 'preact/hooks';
import { nearestComune } from '../core/comuni.ts';
import type { GpsPoint } from '../core/exif.ts';

/** Oltre questa distanza dal comune più vicino che conosciamo, foto o persona non sono in Ticino: non si propone niente. */
export const MAX_KM = 25;

type Source = 'foto' | 'posizione' | 'persona';

/**
 * Comune di ritiro che si compila da solo, in Vendi e in Svuota casa:
 * 1. dalle coordinate della prima foto che le ha (lette nel browser dalla foto originale);
 * 2. se nessuna foto le ha, dalla posizione del telefono: il browser chiede il permesso, una volta sola per pagina,
 *    e se è già stato negato non si chiede più.
 * Un comune scelto dalla persona, o già capito dalla bozza, non si tocca. La foto vince sulla posizione del telefono:
 * dice dov'è l'oggetto. Coordinate e posizione restano nel browser; al server arriva solo il nome del comune.
 */
export function useAutoComune(value: string, setComune: (name: string) => void) {
  const [note, setNote] = useState('');
  const source = useRef<Source | null>(null);
  const asked = useRef(false);
  const current = useRef(value);
  current.current = value;

  /** La persona sceglie o cancella il comune: da qui in poi decide lei. */
  const choose = (name: string) => {
    source.current = 'persona';
    setNote('');
    setComune(name);
  };

  /** Da chiamare a ogni cambio delle foto. */
  const photosChanged = (photos: Array<{ gps?: GpsPoint }>) => {
    if (source.current === 'persona' || source.current === 'foto') return;
    const gps = photos.find((p) => p.gps)?.gps;
    if (gps) {
      // Un comune già scritto (es. capito dalla bozza) resta; quello preso dalla posizione del telefono no
      if (current.current && source.current !== 'posizione') return;
      const { comune, km } = nearestComune(gps);
      if (km <= MAX_KM) {
        source.current = 'foto';
        setComune(comune.name);
        setNote(`Dalle coordinate della foto: ${comune.name}. Se il ritiro è altrove, cambialo.`);
      } else if (!current.current) {
        setNote('La foto è stata scattata fuori dal Ticino: scegli il comune di ritiro.');
      }
      return;
    }
    if (photos.length && !current.current && !asked.current) {
      asked.current = true;
      void locate();
    }
  };

  async function locate() {
    if (!('geolocation' in navigator)) return;
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (status?.state === 'denied') return;
    } catch {
      // Browser senza Permissions API: si chiede comunque
    }
    if (source.current || current.current) return;
    setNote('Per compilare il comune di ritiro chiediamo al browser dove ti trovi. Puoi anche sceglierlo tu.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Nel frattempo ha deciso la persona o una foto
        if (source.current) return;
        const { comune, km } = nearestComune({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (current.current || km > MAX_KM) return setNote('');
        source.current = 'posizione';
        setComune(comune.name);
        setNote(`Dalla tua posizione: ${comune.name}. Se il ritiro è altrove, cambialo.`);
      },
      () => {
        if (!source.current) setNote('');
      },
      { timeout: 15000, maximumAge: 600000 },
    );
  }

  return { note, choose, photosChanged };
}

/* =====================================================================
   MapaVivo · Horarios de apertura (OpenStreetMap)
   ---------------------------------------------------------------------
   Interpreta los formatos más habituales de la etiqueta
   `opening_hours` para saber si un lugar está abierto ahora mismo.

   Es deliberadamente conservador: si el formato es complejo o no se
   entiende con seguridad (festivos, meses, "sunrise", etc.) devuelve
   null y la app no muestra ningún estado, en vez de dar información
   incorrecta.

   Formatos admitidos:
     24/7
     Mo-Fr 09:00-18:00
     Mo-Su 10:00-22:00
     Mo-Fr 09:00-14:00,16:00-20:00; Sa 10:00-14:00
     Su off
     Mo-Sa 20:00-02:00   (cruza medianoche)
   ===================================================================== */
window.OpenHours = (function () {
  'use strict';

  const DAY = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

  // Tokens que no sabemos interpretar con garantías.
  const UNSUPPORTED = /\b(ph|sh|easter|sunrise|sunset|dawn|dusk|week|month)\b/i;
  const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

  function parseDay(token) {
    const key = token.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(DAY, key) ? DAY[key] : null;
  }

  function parseDays(spec) {
    const days = new Set();
    const cleaned = spec.replace(/[A-Za-z]{2}/g, (token) => {
      const day = parseDay(token);
      return day === null ? '\u0000' : token; // marca tokens desconocidos
    });

    if (cleaned.indexOf('\u0000') !== -1) return null;
    if (/[^A-Za-z,\- ]/.test(cleaned)) return null;

    for (const chunk of spec.split(',')) {
      const part = chunk.trim();
      if (!part) continue;

      const bits = part.split('-');
      if (bits.length === 1) {
        const day = parseDay(bits[0]);
        if (day === null) return null;
        days.add(day);
      } else if (bits.length === 2) {
        const start = parseDay(bits[0]);
        const end = parseDay(bits[1]);
        if (start === null || end === null) return null;
        let day = start;
        days.add(day);
        for (let i = 0; i < 7 && day !== end; i += 1) {
          day = (day + 1) % 7;
          days.add(day);
        }
      } else {
        return null;
      }
    }

    return days.size ? days : null;
  }

  function parseTime(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 24 || minutes > 59) return null;
    const total = hours * 60 + minutes;
    return total <= 1440 ? total : null;
  }

  function parseRule(rule) {
    const text = rule.trim();
    if (!text) return null;

    // "Su off" / "Mo-Sa closed"
    const off = /^(.*?)\s+(off|closed)$/i.exec(text);
    if (off) {
      const days = off[1] ? parseDays(off[1]) : null;
      if (!days) return null;
      return { days, ranges: [], closed: true };
    }

    const timeMatch = /^(.*?)\s*(\d{1,2}:\d{2}.*)$/.exec(text);
    if (!timeMatch) return null;

    const daySpec = timeMatch[1].trim();
    const timeSpec = timeMatch[2].trim();

    let days;
    if (daySpec) {
      days = parseDays(daySpec);
      if (!days) return null;
    } else {
      days = new Set([0, 1, 2, 3, 4, 5, 6]);
    }

    const ranges = [];
    for (const chunk of timeSpec.split(',')) {
      const part = chunk.trim();
      if (!part) continue;
      const pieces = part.split('-');
      if (pieces.length !== 2) return null;

      const start = parseTime(pieces[0]);
      const end = parseTime(pieces[1]);
      if (start === null || end === null) return null;
      ranges.push([start, end]);
    }

    if (!ranges.length) return null;
    return { days, ranges, closed: false };
  }

  /**
   * Estado de apertura.
   * @param {string} hours  valor de `opening_hours`
   * @param {Date}   [when] fecha a comprobar (por defecto, ahora)
   * @returns {'open'|'closed'|null} null = desconocido
   */
  function status(hours, when) {
    if (!hours || typeof hours !== 'string') return null;
    const raw = hours.trim();
    if (!raw) return null;

    if (/^24\s*\/\s*7$/i.test(raw)) return 'open';
    if (/^(off|closed)$/i.test(raw)) return 'closed';
    if (UNSUPPORTED.test(raw) || MONTHS.test(raw)) return null;
    if (/[;,]/.test(raw) === false && /^\d{1,2}:\d{2}$/.test(raw)) return null;

    const now = when instanceof Date ? when : new Date();
    const today = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();

    let open = false;
    let parsed = 0;

    for (const part of raw.split(';')) {
      const rule = parseRule(part);
      if (!rule) return null; // alguna regla no se entiende: no afirmamos nada
      parsed += 1;

      if (rule.closed) {
        if (rule.days.has(today)) return 'closed';
        continue;
      }

      for (const [start, end] of rule.ranges) {
        if (start === end) {
          // 00:00-00:00 se interpreta como las 24 horas.
          if (start === 0 && rule.days.has(today)) open = true;
          continue;
        }

        if (start < end) {
          if (rule.days.has(today) && minutes >= start && minutes < end) open = true;
        } else {
          // Cruza medianoche: la parte de madrugada pertenece al día anterior.
          if (rule.days.has(today) && minutes >= start) open = true;
          const yesterday = (today + 6) % 7;
          if (rule.days.has(yesterday) && minutes < end) open = true;
        }
      }
    }

    if (!parsed) return null;
    return open ? 'open' : 'closed';
  }

  return { status };
})();

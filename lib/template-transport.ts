import type { CalibrationTemplate } from "./vision-types";

/** Personal templates as one transferable buffer, for both hops (app →
 * recognition worker → matcher). Structured-cloning ~7,000 nested arrays
 * (300 examples) took ~300 ms on the posting thread; packing takes ~20 ms and
 * the buffer is transferred, not copied. Float64 keeps every value exact, so
 * matching decisions cannot change. */
export type PackedTemplates = {
  meta: Array<Omit<CalibrationTemplate, "frames"> & { widths: number[] }>;
  values: Float64Array;
};

export function packTemplates(templates: CalibrationTemplate[]): PackedTemplates {
  let size = 0;
  for (const template of templates) for (const row of template.frames) size += row.length;
  const values = new Float64Array(size);
  let offset = 0;
  const meta = templates.map(({ frames, ...rest }) => {
    for (const row of frames) { values.set(row, offset); offset += row.length; }
    return { ...rest, widths: frames.map(row => row.length) };
  });
  return { meta, values };
}

export function unpackTemplates({ meta, values }: PackedTemplates): CalibrationTemplate[] {
  let offset = 0;
  return meta.map(({ widths, ...rest }) => ({ ...rest, frames: widths.map(width => {
    const row = new Array<number>(width);
    for (let k = 0; k < width; k++) row[k] = values[offset + k];
    offset += width;
    return row;
  }) }));
}

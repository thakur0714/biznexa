import { describe, expect, it } from 'vitest';
import { acceptAttribute, describeFileTypes, fileTypeFromName } from './index';

describe('upload helpers', () => {
  it('maps extensions to types, case-insensitively, using only the last extension', () => {
    expect(fileTypeFromName('PAN Card.PDF')).toBe('application/pdf');
    expect(fileTypeFromName('photo.jpeg')).toBe('image/jpeg');
    expect(fileTypeFromName('photo.JPG')).toBe('image/jpeg');
    expect(fileTypeFromName('invoice.pdf.exe')).toBeNull();
    expect(fileTypeFromName('README')).toBeNull();
    expect(fileTypeFromName('.png')).toBe('image/png');
  });

  it('describes types for messages and file inputs', () => {
    expect(describeFileTypes(['application/pdf', 'image/jpeg', 'image/png'])).toBe('PDF, JPG or PNG');
    expect(describeFileTypes(['application/pdf'])).toBe('PDF');
    expect(acceptAttribute(['application/pdf', 'image/jpeg'])).toBe('application/pdf,.pdf,image/jpeg,.jpg,.jpeg');
  });
});

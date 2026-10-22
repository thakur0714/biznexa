import { formSchema, FORM_PATTERNS } from '@biznexa/types';
import { isSensitiveField, maskSensitive, openFormData, sealFormData } from './sensitive-form-data';

const FORM = formSchema.parse({
  steps: [
    {
      title: 'Business',
      fields: [
        { type: 'text', name: 'businessName', label: 'Business name' },
        { type: 'text', name: 'businessPan', label: 'PAN', ...FORM_PATTERNS.pan },
        { type: 'text', name: 'accountNumber', label: 'Account number', ...FORM_PATTERNS.bankAccount },
        { type: 'text', name: 'gstin', label: 'GSTIN', ...FORM_PATTERNS.gstin },
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          fields: [
            { type: 'text', name: 'fullName', label: 'Name' },
            { type: 'text', name: 'pan', label: 'PAN', ...FORM_PATTERNS.pan },
          ],
        },
      ],
    },
  ],
});
const fields = FORM.steps[0].fields;

const ANSWERS = {
  businessName: 'Acme',
  businessPan: 'AAACA1234F',
  accountNumber: '123456789012',
  gstin: '03AAAAA0000A1Z5',
  directors: [{ fullName: 'Asha', pan: 'ABCDE1234F' }, { fullName: 'Ravi' }],
};

describe('sensitive form answers (M12.2)', () => {
  it('treats PAN and bank account formats as sensitive, nothing else', () => {
    expect(fields.filter((item) => isSensitiveField(item)).map((f) => f.name)).toEqual(['businessPan', 'accountNumber']);
  });

  it('encrypts sensitive answers, also inside repeater rows, and leaves the rest readable', () => {
    const sealed = sealFormData(FORM, ANSWERS);
    const text = JSON.stringify(sealed);
    for (const secret of ['AAACA1234F', '123456789012', 'ABCDE1234F']) expect(text).not.toContain(secret);
    expect(sealed).toMatchObject({ businessName: 'Acme', gstin: '03AAAAA0000A1Z5', businessPan: { $enc: expect.stringMatching(/^v1\./) } });
    expect((sealed.directors as object[])[1]).toEqual({ fullName: 'Ravi' });
  });

  it('gives the full answers back to an allowed reader and masked ones to anyone else', () => {
    const sealed = sealFormData(FORM, ANSWERS);
    expect(openFormData(sealed, true)).toEqual(ANSWERS);
    expect(openFormData(sealed, false)).toEqual({
      ...ANSWERS,
      businessPan: 'AAACA****F',
      accountNumber: '••••••••9012',
      directors: [{ fullName: 'Asha', pan: 'ABCDE****F' }, { fullName: 'Ravi' }],
    });
  });

  it('reads answers saved before encryption unchanged, and empty answers as none', () => {
    expect(openFormData(ANSWERS, false)).toEqual(ANSWERS);
    expect(openFormData(null, true)).toEqual({});
    expect(sealFormData(FORM, { businessPan: '' })).toEqual({ businessPan: '' });
  });

  it('masks short values completely', () => {
    expect(maskSensitive('1234')).toBe('••••');
  });
});

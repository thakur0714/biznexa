import { richTextSchema } from '@biznexa/types';
import { sanitizeRichText } from '@biznexa/rich-text';

/**
 * Rich-text field for API input schemas (CMS pages M9.5, homepage M9.6, blog M9.7): checks the length
 * and hands the service only sanitised HTML (D60), so nothing unsanitised is ever saved.
 */
export const richTextInput = richTextSchema.transform(sanitizeRichText);

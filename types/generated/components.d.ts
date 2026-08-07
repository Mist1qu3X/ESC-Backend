import type { Schema, Struct } from '@strapi/strapi';

export interface DocumentAttachment extends Struct.ComponentSchema {
  collectionName: 'components_document_attachments';
  info: {
    description: 'A single downloadable file within a document';
    displayName: 'Attachment';
    icon: 'file';
  };
  attributes: {
    date: Schema.Attribute.Date;
    downloadCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    file: Schema.Attribute.Media<'files'>;
    fileSize: Schema.Attribute.String & Schema.Attribute.DefaultTo<'1.0 MB'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    version: Schema.Attribute.String & Schema.Attribute.DefaultTo<'v1.0'>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'document.attachment': DocumentAttachment;
    }
  }
}

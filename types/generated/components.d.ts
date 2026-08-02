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

export interface ResultsLeader extends Struct.ComponentSchema {
  collectionName: 'components_results_leaders';
  info: {
    description: 'One row in an event result table';
    displayName: 'Leader';
    icon: 'trophy';
  };
  attributes: {
    athleteName: Schema.Attribute.String & Schema.Attribute.Required;
    federationCode: Schema.Attribute.String;
    flag: Schema.Attribute.Media<'images'>;
    inner10s: Schema.Attribute.String;
    note: Schema.Attribute.String;
    position: Schema.Attribute.Integer & Schema.Attribute.Required;
    shots: Schema.Attribute.JSON;
    total: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'document.attachment': DocumentAttachment;
      'results.leader': ResultsLeader;
    }
  }
}

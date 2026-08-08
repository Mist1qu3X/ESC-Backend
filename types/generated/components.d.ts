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

export interface EventScheduleRow extends Struct.ComponentSchema {
  collectionName: 'components_event_schedule_rows';
  info: {
    description: "A single row in an event's schedule (ALL EVENTS table)";
    displayName: 'Schedule Row';
    icon: 'calendar';
  };
  attributes: {
    date: Schema.Attribute.Date & Schema.Attribute.Required;
    order: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    stage: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'Qualification'>;
    time: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'document.attachment': DocumentAttachment;
      'event.schedule-row': EventScheduleRow;
    }
  }
}

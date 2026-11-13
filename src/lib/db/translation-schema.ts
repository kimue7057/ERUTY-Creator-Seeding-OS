import {pgTable,uuid,text,timestamp,primaryKey} from 'drizzle-orm/pg-core';
export const outreachReviewTranslations=pgTable('outreach_review_translations',{
 organizationId:uuid('organization_id').notNull(),sourceSha256:text('source_sha256').notNull(),
 sourceSubject:text('source_subject').notNull(),sourceBody:text('source_body').notNull(),
 subject:text().notNull(),body:text().notNull(),model:text().notNull(),createdBy:uuid('created_by').notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.organizationId,t.sourceSha256]})]);

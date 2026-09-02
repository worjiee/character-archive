export interface JanitorTag {
  id?: string | number | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

export interface JanitorScript {
  id?: string | null;
  type?: string | null;
  title?: string | null;
  [key: string]: unknown;
}

export interface JanitorGreetingObject {
  content?: string | null;
  message?: string | null;
  text?: string | null;
  [key: string]: unknown;
}

export type JanitorGreetingValue = string | JanitorGreetingObject;

export interface JanitorCharacterResponse {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  example_dialogs?: string | null;
  avatar?: string | null;
  creator_id?: string | null;
  creator_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_public?: boolean | null;
  is_deleted?: boolean | null;
  first_message?: JanitorGreetingValue | null;
  first_messages?: Array<JanitorGreetingValue | null> | null;
  tags?: Array<JanitorTag | null> | null;
  custom_tags?: Array<string | null> | null;
  scripts?: Array<JanitorScript | null> | null;
  [key: string]: unknown;
}

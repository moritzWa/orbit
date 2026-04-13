export interface Contact {
  id: number
  display_name: string
  first_name: string | null
  last_name: string | null
  organization: string | null
  linkedin_headline: string | null
  linkedin_url: string | null
  linkedin_location: string | null
  x_username: string | null
  apple_contact_uuid: string | null
  beeper_thread_url: string | null
  message_count: number
  first_contacted: string | null
  last_contacted: string | null
  profile_picture_url: string | null
  stay_in_touch_days: number | null
  snoozed_until: string | null
  paused: number
  notes: string | null
  phones: string | null
  emails: string | null
}

export interface Message {
  text: string | null
  is_from_me: number
  date: string
  source: string
}

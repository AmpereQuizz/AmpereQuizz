// Connexion à Supabase (comptes, listes perso, scores, défis).
// La clé « anon / publishable » est faite pour être publique : la sécurité repose sur les règles de la base
// (voir supabase/schema.sql). Laisser vide pour désactiver les comptes.
export const SUPABASE_URL = 'https://lahmvyzejqhanuqqujmq.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_psenKkbPKhq69J5w2vkznQ_eUAWAFwH';
// Supabase exige une adresse e-mail : on la fabrique avec ce domaine (aucun mail n'est envoyé).
export const EMAIL_DOMAIN = 'gladuro.github.io';

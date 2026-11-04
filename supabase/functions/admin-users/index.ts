// Supabase Edge Function "admin-users": legt Mitarbeiter-Konten an und setzt Passwörter. Nur für den Admin.
// Der service_role key steht nur hier auf dem Server (wird von Supabase automatisch bereitgestellt), nie im Browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // 1) Wer ruft auf? Nur der aktive Admin darf weiter.
    const admin = createClient(url, service);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'Nicht angemeldet' }, 401);
    const { data: me } = await admin.from('profiles').select('role,status').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || me.status !== 'active') return json({ error: 'Nur der Admin darf das' }, 403);

    const b = await req.json();

    // 2) Neuen Mitarbeiter anlegen
    if (b.action === 'create') {
      const email = String(b.email ?? '').trim().toLowerCase();
      const name = String(b.name ?? '').trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || String(b.password ?? '').length < 8) {
        return json({ error: 'Name, gültige E-Mail und Passwort (mind. 8 Zeichen) angeben' }, 400);
      }
      const { data, error } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { name } });
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Diese E-Mail ist bereits angelegt' : error.message }, 400);
      const { error: e2 } = await admin.from('profiles').update({
        status: 'active', name,
        department: String(b.department ?? ''),
        weekly_hours: Number(b.weekly_hours) || 38.5,
        vacation_days: Number(b.vacation_days) || 0,
        work_days: String(b.work_days || '1,2,3,4,5'),
        start_date: b.start_date || new Date().toISOString().slice(0, 10),
        opening_balance: Number(b.opening_balance) || 0,
      }).eq('id', data.user.id);
      if (e2) return json({ error: e2.message }, 400);
      return json({ id: data.user.id });
    }

    // 3) Passwort eines Mitarbeiters neu setzen
    if (b.action === 'set_password') {
      if (String(b.password ?? '').length < 8) return json({ error: 'Passwort: mind. 8 Zeichen' }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ error: 'Serverfehler' }, 500);
  }
});

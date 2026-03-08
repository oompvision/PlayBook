import { supabase } from './supabase';

/**
 * Ensures the current user is linked as a customer to the given org.
 * Mirrors the web app's ensureCustomerOrg() function.
 */
export async function ensureCustomerOrg(orgId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single();

  // If customer has no org yet, link them to this facility
  if (profile && !profile.org_id) {
    await supabase
      .from('profiles')
      .update({ org_id: orgId })
      .eq('id', user.id);
  }
}

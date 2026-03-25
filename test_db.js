import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load .env
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.rpc('get_table_schema', { table_name: 'commission_entries' });
  if (error) {
    console.error('RPC failed, trying raw insert to get precise error', error);
    const { data: d2, error: e2 } = await supabase.from('commission_entries').insert([{ user_id: '123e4567-e89b-12d3-a456-426614174000', user_name: 'test', product_id: '123e4567-e89b-12d3-a456-426614174000', product_name: 'test', role: 'operator', quantity: 1, rate_per_qty: 1, amount: 1, ref: 'test' }]);
    console.log(e2);
  } else {
    console.log(data);
  }
}
check();

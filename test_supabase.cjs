const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
let url = '', key = '';
envFile.split('\n').forEach(line => {
    if (line.startsWith('VITE_SUPABASE_URL=')) url = line.split('=')[1].trim();
    if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim();
});

const supabase = createClient(url, key);

async function check() {
    const { data, error } = await supabase
        .from('journal_entries')
        .select(`
      id,
      created_by_profile:profiles!journal_entries_created_by_fkey(full_name)
    `)
        .limit(1);

    if (error) {
        console.log("Failed with _fkey:", error.message);
        const { data: d2, error: e2 } = await supabase
            .from('journal_entries')
            .select('id, profiles!created_by(full_name)')
            .limit(1);
        if (e2) console.log("Failed with profiles!created_by:", e2.message);
        else console.log("Success with profiles!created_by:", d2);
    } else {
        console.log("Success with _fkey:", data);
    }
}

check();

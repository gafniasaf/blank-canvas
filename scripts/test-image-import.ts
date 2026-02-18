import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runTest() {
  const filePath = '/Users/asafgafni/Desktop/InDesign/TestRun/designs-relinked/MBO Communicatie_9789083251387_03.2024.idml';
  const fileName = path.basename(filePath);
  const storagePath = `uploads/${fileName}`;
  
  console.log(`🚀 Starting test import for: ${fileName}`);

  // 1. Upload File
  console.log('📤 Uploading IDML to Storage...');
  const fileContent = fs.readFileSync(filePath);
  const { error: uploadError } = await supabase.storage
    .from('book-uploads')
    .upload(storagePath, fileContent, {
      contentType: 'application/vnd.adobe.indesign-idml-package',
      upsert: true
    });

  if (uploadError) {
    console.error('❌ Upload failed:', uploadError);
    return;
  }
  console.log('✅ Upload complete');

  // 2. Create Upload Record (simulating frontend)
  console.log('📝 Creating upload record...');
  const { data: uploadRecord, error: dbError } = await supabase
    .from('book_uploads')
    .insert({
      title: 'Test Communicatie (Image Context)',
      level: 'n3',
      storage_path: storagePath,
      status: 'uploaded'
    })
    .select()
    .single();

  if (dbError) {
    console.error('❌ DB insert failed:', dbError);
    return;
  }
  console.log(`✅ Record created: ${uploadRecord.id}`);

  // 3. Trigger Normalize Function
  console.log('⚡ Triggering idml-normalize...');
  const response = await fetch(`${supabaseUrl}/functions/v1/idml-normalize`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      upload_id: uploadRecord.id,
      storage_path: storagePath
    })
  });

  const result = await response.json();
  if (!response.ok) {
    console.error('❌ Normalize failed:', result);
    return;
  }
  console.log('✅ Normalize complete:', result);

  // 4. Verify Results
  console.log('\n🔍 Verifying Database Content...');
  
  // Check paragraphs
  const { count: paraCount } = await supabase
    .from('book_paragraphs')
    .select('*', { count: 'exact', head: true })
    .eq('upload_id', uploadRecord.id);
    
  console.log(`📄 Paragraphs found: ${paraCount}`);

  // Check images
  const { data: images, error: imgError } = await supabase
    .from('book_images')
    .select('*')
    .eq('upload_id', uploadRecord.id);

  if (imgError) {
     console.error('❌ Failed to fetch images:', imgError);
  } else {
     console.log(`🖼️ Images found: ${images.length}`);
     if (images.length > 0) {
       console.log('\nSample Images with Context:');
       images.slice(0, 5).forEach((img, i) => {
         console.log(`[${i+1}] ${img.filename}`);
         console.log(`    Paragraph ID: ${img.paragraph_id}`);
         console.log(`    Chapter: ${img.chapter_number}`);
         console.log(`    Tags: [${img.context_tags?.join(', ')}]`);
         console.log('');
       });
     } else {
       console.log('⚠️ No images extracted! Check regex logic.');
     }
  }
}

runTest().catch(console.error);

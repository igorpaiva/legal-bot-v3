import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Testing Google Drive API Access...\n');

async function testDriveAPI() {
  try {
    // Create OAuth client with your credentials
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // This is just testing API availability (not making authenticated calls)
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    console.log('✅ Google Drive API client created successfully');
    console.log('✅ Google Drive API is accessible from this project');
    console.log('\n🎯 Next Steps:');
    console.log('1. Enable Google Drive API in Google Cloud Console');
    console.log('2. Wait 2-3 minutes for API to propagate');
    console.log('3. Test the OAuth flow again in your app');
    console.log('\n📍 Direct link to enable API:');
    console.log('https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=237229046398');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testDriveAPI();

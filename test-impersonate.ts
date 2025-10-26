#!/usr/bin/env bun

// Test script for impersonate feature
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

async function runImpersonateTest() {
  console.log('🧪 Testing Impersonate Feature\n');

  try {
    // Step 1: Authenticate as superuser
    console.log('1. Authenticating as superuser...');
    const superuserAuth = await pb.collection('_superusers').authWithPassword(
      'admin@example.com',
      'admin123'
    );
    console.log('✅ Superuser authenticated:', superuserAuth.record.email);
    console.log('   Superuser token:', superuserAuth.token.substring(0, 30) + '...');
    console.log('   Is superuser?', pb.authStore.isSuperuser);
    console.log('');

    // Step 2: Impersonate a regular user
    console.log('2. Impersonating user "Alice" (user1xxxxxxxxxx)...');
    const impersonateClient = await pb.collection('users').impersonate(
      'user1xxxxxxxxxx',
      3600 // 1 hour duration
    );
    console.log('✅ Impersonation successful!');
    console.log('   Impersonated user:', impersonateClient.authStore.record?.email);
    console.log('   Impersonate token:', impersonateClient.authStore.token.substring(0, 30) + '...');
    console.log('   Is superuser?', impersonateClient.authStore.isSuperuser);
    console.log('   Is auth record?', impersonateClient.authStore.isAuthRecord);
    console.log('');

    // Step 3: Use impersonated client to make requests
    console.log('3. Testing impersonated client (get posts as Alice)...');
    const posts = await impersonateClient.collection('posts').getList(1, 10);
    console.log('✅ Successfully fetched posts as impersonated user');
    console.log(`   Found ${posts.totalItems} posts`);
    console.log('');

    // Step 4: Try to impersonate without superuser privileges (should fail)
    console.log('4. Testing impersonate without superuser (should fail)...');
    try {
      // First authenticate as regular user
      const regularPb = new PocketBase(TEST_URL);
      await regularPb.collection('users').authWithPassword(
        'bob@example.com',
        'password123'
      );
      console.log('   Authenticated as regular user Bob');
      
      // Try to impersonate (should fail)
      await regularPb.collection('users').impersonate('user1xxxxxxxxxx', 3600);
      console.log('❌ ERROR: Impersonate should have failed for non-superuser!');
    } catch (error: any) {
      console.log('✅ Correctly blocked non-superuser impersonation');
      console.log(`   Error: ${error.message}`);
    }
    console.log('');

    console.log('🎉 All impersonate tests passed!');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', error.response);
    }
    process.exit(1);
  }
}

runImpersonateTest();

#!/usr/bin/env bun

// Simple manual test for auth API
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

async function runAuthTests() {
  console.log('🧪 Testing Authentication API\n');

  try {
    // Test 1: List Auth Methods
    console.log('1. Testing listAuthMethods()...');
    const methods = await pb.collection('users').listAuthMethods();
    console.log('✅ Auth methods:', JSON.stringify(methods, null, 2));

    // Test 2: Create a test user
    console.log('\n2. Creating test user...');
    const testEmail = `test_${Date.now()}@example.com`;
    const testPassword = 'test123456';
    
    const user = await pb.collection('users').create({
      name: 'Test User',
      email: testEmail,
      password: testPassword,
    });
    console.log('✅ User created:', user.id);

    // Test 3: Authenticate with password
    console.log('\n3. Testing authWithPassword()...');
    const authData = await pb.collection('users').authWithPassword(testEmail, testPassword);
    console.log('✅ Authenticated! Token:', authData.token.substring(0, 20) + '...');
    console.log('   User:', authData.record.email);
    console.log('   Auth store valid:', pb.authStore.isValid);

    // Test 4: Refresh token
    console.log('\n4. Testing authRefresh()...');
    const refreshData = await pb.collection('users').authRefresh();
    console.log('✅ Token refreshed:', refreshData.token.substring(0, 20) + '...');

    // Test 5: Request OTP
    console.log('\n5. Testing requestOTP()...');
    const otpResult = await pb.collection('users').requestOTP(testEmail);
    console.log('✅ OTP requested, ID:', otpResult.otpId);

    // Test 6: Test invalid credentials
    console.log('\n6. Testing invalid credentials...');
    try {
      await pb.collection('users').authWithPassword(testEmail, 'wrongpassword');
      console.log('❌ Should have failed!');
    } catch (error: any) {
      console.log('✅ Correctly rejected invalid password');
    }

    // Cleanup
    console.log('\n7. Cleaning up...');
    await pb.collection('users').delete(user.id);
    console.log('✅ Test user deleted');

    console.log('\n🎉 All auth tests passed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('   Status:', error.status);
    console.error('   Response:', error.response);
    process.exit(1);
  }
}

runAuthTests();

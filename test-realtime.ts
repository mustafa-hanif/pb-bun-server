#!/usr/bin/env bun

// Polyfill EventSource for Node/Bun environment
import { EventSource } from 'eventsource';
(globalThis as any).EventSource = EventSource;

// Test script for realtime subscriptions
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

async function runRealtimeTest() {
  console.log('🧪 Testing Realtime Subscriptions\n');

  try {
    // Step 1: Subscribe to all users
    console.log('1. Subscribing to users/* (all user events)...');
    let createEventReceived = false;
    let updateEventReceived = false;
    let deleteEventReceived = false;

    let unsubscribe;
    try {
      unsubscribe = await pb.collection('users').subscribe('*', (e) => {
        console.log(`📨 Event received:`, {
          action: e.action,
          recordId: e.record.id,
          recordName: e.record.name,
        });

        if (e.action === 'create') createEventReceived = true;
        if (e.action === 'update') updateEventReceived = true;
        if (e.action === 'delete') deleteEventReceived = true;
      });
    } catch (err: any) {
      console.error('❌ Subscription failed:', err);
      console.error('   Stack:', err.stack);
      throw err;
    }

    console.log('✅ Subscribed to users/*');
    console.log('   Waiting for connection to establish...\n');

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Create a new user
    console.log('2. Creating a new user...');
    const newUser = await pb.collection('users').create({
      name: 'Realtime Test User',
      email: 'realtime@example.com',
      username: 'realtimetest',
      password: 'test123',
      verified: 1,
    });
    console.log(`✅ User created: ${newUser.id}`);

    // Wait for event
    await new Promise(resolve => setTimeout(resolve, 500));

    if (createEventReceived) {
      console.log('✅ CREATE event received!\n');
    } else {
      console.log('❌ CREATE event NOT received\n');
    }

    // Step 3: Update the user
    console.log('3. Updating the user...');
    await pb.collection('users').update(newUser.id, {
      name: 'Updated Realtime User',
    });
    console.log(`✅ User updated`);

    // Wait for event
    await new Promise(resolve => setTimeout(resolve, 500));

    if (updateEventReceived) {
      console.log('✅ UPDATE event received!\n');
    } else {
      console.log('❌ UPDATE event NOT received\n');
    }

    // Step 4: Delete the user
    console.log('4. Deleting the user...');
    await pb.collection('users').delete(newUser.id);
    console.log(`✅ User deleted`);

    // Wait for event
    await new Promise(resolve => setTimeout(resolve, 500));

    if (deleteEventReceived) {
      console.log('✅ DELETE event received!\n');
    } else {
      console.log('❌ DELETE event NOT received\n');
    }

    // Step 5: Unsubscribe
    console.log('5. Unsubscribing...');
    await unsubscribe();
    console.log('✅ Unsubscribed\n');

    // Step 6: Test specific record subscription
    console.log('6. Testing specific record subscription...');
    const testUser = await pb.collection('users').getOne('user1xxxxxxxxxx');
    console.log(`   Subscribing to users/${testUser.id} (specific user)...`);

    let specificEventReceived = false;
    const unsubscribeSpecific = await pb.collection('users').subscribe(testUser.id, (e) => {
      console.log(`📨 Specific event received:`, {
        action: e.action,
        recordId: e.record.id,
      });
      specificEventReceived = true;
    });

    console.log('✅ Subscribed to specific user');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('   Updating the specific user...');
    await pb.collection('users').update(testUser.id, {
      name: testUser.name + ' (updated)',
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    if (specificEventReceived) {
      console.log('✅ Specific record event received!\n');
    } else {
      console.log('❌ Specific record event NOT received\n');
    }

    await unsubscribeSpecific();

    // Summary
    console.log('🎉 Realtime test completed!');
    console.log('');
    console.log('Results:');
    console.log(`  CREATE events: ${createEventReceived ? '✅' : '❌'}`);
    console.log(`  UPDATE events: ${updateEventReceived ? '✅' : '❌'}`);
    console.log(`  DELETE events: ${deleteEventReceived ? '✅' : '❌'}`);
    console.log(`  Specific subscription: ${specificEventReceived ? '✅' : '❌'}`);

    if (createEventReceived && updateEventReceived && deleteEventReceived && specificEventReceived) {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', error.response);
    }
    process.exit(1);
  }
}

runRealtimeTest();

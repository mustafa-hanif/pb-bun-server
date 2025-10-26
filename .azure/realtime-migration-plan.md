# PocketBase Realtime Service Migration Plan

## Overview
The Realtime service provides Server-Sent Events (SSE) based real-time subscriptions to database changes. Clients can subscribe to specific collections and records, receiving instant notifications when data is created, updated, or deleted.

## Architecture

### How PocketBase Realtime Works

1. **SSE Connection**: Client opens EventSource connection to `/api/realtime`
2. **Client Registration**: Server assigns unique `clientId` via `PB_CONNECT` event
3. **Subscription Management**: Client sends subscriptions to `/api/realtime` POST endpoint
4. **Event Broadcasting**: Server pushes events to subscribed clients when data changes
5. **Topic Format**: `{collection}/{topic}` where topic is `*` (all) or specific record ID

### Event Flow
```
Client                          Server
  |                               |
  |-- GET /api/realtime -------->|  (Open SSE connection)
  |<---- PB_CONNECT(clientId) ---|  (Server assigns clientId)
  |                               |
  |-- POST /api/realtime -------->|  (Send subscriptions: ["users/*", "posts/xyz"])
  |<---- 204 No Content ----------|  (Subscriptions registered)
  |                               |
  |                               |  [Database change occurs]
  |<---- SSE Event: users/* ------|  (Push event to client)
  |     {action: "create", record: {...}}
```

### Event Format
```typescript
interface RecordSubscription {
  action: 'create' | 'update' | 'delete';
  record: {
    id: string;
    collectionName: string;
    // ... other fields
  };
}
```

## Implementation Plan

### Phase 1: Core SSE Infrastructure
**Files to create:**
- `src/api/realtime.ts` - Main realtime service

**Key Components:**
1. **Client Management**
   - Generate unique clientId for each connection
   - Track active SSE connections: `Map<clientId, Response>`
   - Track client subscriptions: `Map<clientId, Set<topic>>`

2. **SSE Connection Endpoint**
   ```typescript
   GET /api/realtime
   - Creates SSE connection
   - Sends PB_CONNECT event with clientId
   - Keeps connection alive with heartbeat
   - Handles disconnect cleanup
   ```

3. **Subscription Management Endpoint**
   ```typescript
   POST /api/realtime
   Body: { clientId, subscriptions: ["collection/topic", ...] }
   - Validates clientId exists
   - Updates client's subscription list
   - Returns 204 No Content
   ```

### Phase 2: Event Broadcasting
**Integration points:**
- Hook into RecordsAPI create/update/delete operations
- Broadcast events to subscribed clients

**Broadcasting Logic:**
```typescript
function broadcastEvent(collection: string, action: string, record: any) {
  // For each active client
  for (const [clientId, sseConnection] of clients) {
    const subscriptions = clientSubscriptions.get(clientId);
    
    // Check if client subscribed to this event
    if (subscriptions.has(`${collection}/*`) || 
        subscriptions.has(`${collection}/${record.id}`)) {
      // Send SSE event
      sseConnection.write(`event: ${collection}/*\n`);
      sseConnection.write(`data: ${JSON.stringify({action, record})}\n\n`);
    }
  }
}
```

### Phase 3: Advanced Features

1. **Heartbeat/Keep-Alive**
   - Send periodic comment to keep connection alive
   - Detect dead connections and cleanup

2. **Topic Matching**
   - Wildcard matching: `users/*` matches all user events
   - Specific ID matching: `users/xyz123` matches only that user
   - Handle topic options (query params, headers)

3. **Connection Management**
   - Handle client disconnections gracefully
   - Cleanup subscriptions on disconnect
   - Reconnection handling

4. **Authorization**
   - Check if client can subscribe to protected collections
   - Verify auth token for subscriptions requiring authentication
   - Filter events based on user permissions

## Technical Considerations

### Bun SSE Support
Bun natively supports SSE through Response streaming:
```typescript
new Response(
  new ReadableStream({
    start(controller) {
      // Send SSE messages
      controller.enqueue('event: PB_CONNECT\n');
      controller.enqueue(`data: ${clientId}\n\n`);
    }
  }),
  {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  }
)
```

### State Management
- Use in-memory Map for clients (consider Redis for multi-instance)
- Clean up on disconnect to prevent memory leaks
- Handle server restart gracefully (clients auto-reconnect)

### Testing Strategy
1. **Unit Tests**: Test subscription matching, event formatting
2. **Integration Tests**: Test full SSE flow with SDK client
3. **Stress Tests**: Multiple clients, many subscriptions

## Migration Steps

### Step 1: Create Realtime Service
```bash
touch src/api/realtime.ts
```
- Implement SSE connection handler
- Implement subscription management
- Add client tracking

### Step 2: Integrate with Server
```typescript
// src/server.ts
import { RealtimeAPI } from './api/realtime';

const realtimeAPI = new RealtimeAPI(db);
app.route('/api/realtime', realtimeAPI.routes());
```

### Step 3: Hook into Records API
```typescript
// src/api/records.ts
import { broadcastEvent } from './realtime';

// In create handler
const record = await createRecord(...);
broadcastEvent(collection, 'create', record);
```

### Step 4: Test with SDK
```typescript
const pb = new PocketBase('http://localhost:8090');

// Subscribe to all users
pb.collection('users').subscribe('*', (e) => {
  console.log(e.action, e.record);
});

// Create a user (should trigger event)
await pb.collection('users').create({ name: 'Test' });
```

### Step 5: Add Tests
- Test SSE connection establishment
- Test subscription management
- Test event broadcasting
- Test disconnect handling
- Test authorization

## API Endpoints Summary

### GET /api/realtime
**Response**: SSE stream
**Events**:
- `PB_CONNECT`: Initial connection event with clientId as lastEventId
- `{collection}/{topic}`: Data change events

### POST /api/realtime
**Request**:
```json
{
  "clientId": "abc123",
  "subscriptions": [
    "users/*",
    "posts/xyz123",
    "comments/*?options=..."
  ]
}
```
**Response**: 204 No Content

## Success Criteria
- [ ] SSE connection establishes successfully
- [ ] PB_CONNECT event received with clientId
- [ ] Subscriptions can be added/updated via POST
- [ ] Events broadcast when records created/updated/deleted
- [ ] Wildcard (`*`) subscriptions work
- [ ] Specific ID subscriptions work
- [ ] Multiple clients can subscribe independently
- [ ] Disconnect cleanup works properly
- [ ] Authorization checks respected
- [ ] SDK integration tests pass

## Next Steps After Realtime
1. Settings API - Application configuration
2. Collection API - Schema management
3. Logs API - Activity logging
4. Health API - Server health checks
5. Backup API - Database backup/restore

## Notes
- PocketBase uses SSE (not WebSocket) for simpler implementation
- SSE is unidirectional (server → client only)
- Client reconnection is automatic in SDK
- Consider implementing connection pooling for scale
- May need to implement sticky sessions for load balancing

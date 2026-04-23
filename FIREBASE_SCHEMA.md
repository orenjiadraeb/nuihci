# Firebase Database Schema

## Collections

### `users`
- `uid` (string): Authenticated Firebase UID.
- `displayName` (string): User name shown in UI.
- `email` (string): User email.
- `photoURL` (string): Profile picture URL.
- `status` (string): Current presence/status text.
- `createdAt` (timestamp): Document creation time.
- `updatedAt` (timestamp): Last profile update.
- `role` (string): Optional user role such as `admin`, `member`, or `guest`.

### `conversations`
- `id` (string): Document ID for the conversation.
- `title` (string): Display title for the conversation.
- `type` (string): `private` or `group`.
- `participants` (array<string>): List of user UIDs.
- `createdAt` (timestamp): Conversation creation time.
- `updatedAt` (timestamp): Last message or metadata update.
- `lastMessage` (map): Summary of the latest message.

### `conversations/{conversationId}/messages`
- `text` (string): Message body text.
- `senderId` (string): UID of the sender.
- `senderName` (string): Display name of the sender.
- `type` (string): Message type, e.g. `text`, `image`, `file`.
- `attachments` (array<map>): Optional file payload metadata.
- `status` (string): `sent`, `delivered`, or `read`.
- `createdAt` (timestamp): Message creation time.

### `typingIndicators`
- `conversationId` (string): Conversation document ID.
- `userId` (string): UID of the typing user.
- `isTyping` (boolean): Whether the user is typing.
- `updatedAt` (timestamp): Last heartbeat update.

## Storage

### Paths
- `profiles/{userId}/{filename}`: Profile image uploads.
- `messages/{conversationId}/{filename}`: Message attachments.
- `uploads/{userId}/{timestamp}_{filename}`: Generic file uploads.

## Cloud Functions

### `api`
An HTTP function exposes user management APIs:
- `POST /users` - create user record and Firebase auth user.
- `GET /users/:uid` - read user profile.
- `PUT /users/:uid` - update user metadata.
- `DELETE /users/:uid` - delete user account and profile.
- `POST /notifications` - send push notifications.

### `onMessageCreate`
Triggered when a new message is created under `conversations/{conversationId}/messages/{messageId}`.
- Sends a notification to subscribed devices.
- Updates conversation metadata if needed.

## Notes
- Use Firestore rules to enforce authenticated access.
- Store sensitive Firebase config in environment variables and do not commit production service account files.
- Use `VITE_FIREBASE_*` variables for frontend configuration.

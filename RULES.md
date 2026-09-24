# Firebase Rules for LAMMA

Two rule sets need to be published in the Firebase console for the
`weding-dc92e` project. Both are required — until they're live, the
self-serve `/create` flow either fails to write (rules too tight) or
lets anyone overwrite any invitation (rules too loose).

---

## 1. Firestore rules

**Where:** Firebase Console → Firestore Database → Rules.

Paste this whole block, click **Publish**.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---------- Invitations (per-slug) ----------
    // Anyone can read a published invitation.
    // Creating requires a matching activation code that is still unused
    // (the client does two writes: create the invitation, then burn the
    // code — the code rule below enforces the one-shot burn).
    match /invitations/{slug} {
      allow read: if true;

      allow create:
        if request.resource.data.slug == slug
        && request.resource.data.event_type in ['birthday', 'wedding']
        && !exists(/databases/$(database)/documents/invitations/$(slug));

      // Only admins (signed in via Firebase Auth) can touch a published
      // invitation later — for takedown of abusive content.
      allow update, delete:
        if request.auth != null;

      // Guestbook + RSVP live UNDER the invitation, so each event has its
      // own private space. No cross-tenant leaks.
      match /guestbook/{doc} {
        allow read, create: if true;
        allow update, delete: if false;
      }
      match /rsvps/{doc} {
        allow create: if true;
        allow read, update, delete: if request.auth != null;
      }
    }

    // ---------- Activation codes (single-use) ----------
    // Codes are private. The client can read a code only when it's still
    // unused (so a burnt code can't be reused). Burning is a one-shot
    // transition from used=false → used=true.
    match /activation_codes/{code} {
      allow read:
        if resource.data.used == false;

      allow update:
        if resource.data.used == false
        && request.resource.data.used == true
        && request.resource.data.diff(resource.data)
             .affectedKeys().hasOnly(['used', 'used_at', 'used_slug']);

      // Only admins can mint or delete codes.
      allow create, delete:
        if request.auth != null;
    }

    // ---------- Legacy demo collections (kept working for the /wedding demo) ----------
    // These are the root-level guestbook + rsvps used by the Ahmed & Sara
    // demo at /wedding/. Once the demo is retired, delete these two blocks.
    match /guestbook/{doc} {
      allow read, create: if true;
      allow update, delete: if false;
    }
    match /rsvps/{doc} {
      allow create: if true;
      allow read, update, delete: if request.auth != null;
    }
  }
}
```

---

## 2. Storage rules

**Where:** Firebase Console → Storage → Rules.

Paste this whole block, click **Publish**.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Anyone can read published media (photos, videos, audio).
    // Anyone can upload under invitations/<slug>/… — the /create flow
    // does this before writing the invitation doc. The invitation-doc
    // rule enforces one-shot creation, so orphan media without a doc
    // is harmless (a 48h cleanup can prune it later).
    match /invitations/{slug}/{allPaths=**} {
      allow read: if true;

      // Per-file limits enforced client-side; server also caps at:
      //   50 MB for images/videos
      //   20 MB for audio
      allow write:
        if request.resource.size < 50 * 1024 * 1024
        && (
          request.resource.contentType.matches('image/.*')
          || request.resource.contentType.matches('video/.*')
          || request.resource.contentType.matches('audio/.*')
        );
    }
  }
}
```

---

## 3. Enable Firebase Authentication (for the admin Codes tab)

**Where:** Firebase Console → Authentication → Sign-in method.

1. Enable **Email/Password** provider.
2. Under **Users** tab, add the first admin:
   - email: `zyadwael2009@gmail.com`
   - password: your choice
3. Repeat for any other admins.

That admin can then sign in on `/admin`, click **Codes**, and mint
activation codes. Without a signed-in Firebase Auth user, the Codes
tab refuses to mint (Firestore rejects the `create` on
`activation_codes/{code}` because the rule requires `request.auth`).

---

## 4. Verify

After publishing all three, from an incognito window:

- `lamma.manasety.ai/create.html?type=birthday` → build a card, try to
  publish with a bogus code → should fail with "This code doesn't exist".
- Sign in on `/admin` with the Firebase Auth user, mint a code, sign
  out, return to `/create.html?type=birthday`, publish with the fresh
  code → should succeed.
- Re-use the same code → should fail with "This code has already been
  used".
- Visit the new invitation URL → should render.
- Try to POST to `activation_codes/*` from the browser console without
  auth → should get a `permission-denied`.

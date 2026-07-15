---
name: ml-listing-photos
description: Use when creating a Mercado Libre listing that includes attached images, a ZIP file, an explicit local image folder, or local image paths. Upload the pictures securely before preparing the paused listing draft.
---

# Mercado Libre listing photos

When the user supplies listing photos, handle the upload internally. Do not ask the user to configure another server, create a URL, copy a token, or upload images manually.

1. Obtain the seller `connection_id` with `list_connections` if needed.
2. Call remote `start_listing_photo_upload` with that connection.
3. Pass its `upload_token` only to local `upload_listing_photos`, together with exactly one user-provided ZIP path, folder path, or image-path list.
4. Use the returned `pictures` in `prepare_listing` and `draft_create_listing`.

Accept JPG, JPEG and PNG only, up to 20 images and 10 MB per image. If there is no usable local path for an attachment, ask the user to provide a ZIP, photo folder, or explicit local image paths. Never display, quote, save, or reuse the temporary upload token.

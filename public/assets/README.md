# Local asset bucket

Stands in for the CDN during development. `lib/pipeline/cdn.ts` writes
content-addressed paths under here:

```
public/assets/
  models/<first-2-chars-of-sha256>/<full-sha256>/{high,medium,low}.glb
  source/<first-2-chars-of-sha256>/<sha256>.<ext>
```

Nothing is committed: meshes are generated artefacts, and a `.glb` per dish per
LOD tier does not belong in git. In production, point `ASSET_CDN_URL` and
`NEXT_PUBLIC_ASSET_CDN_URL` at a real bucket instead.

A dish with no mesh yet — or whose object has been purged — is not an error.
`TasteBuddyARViewer` preflights the URL (`lib/hooks/useAssetAvailability.ts`)
and falls back to a procedural stand-in, so the AR view always shows something
on the plate.

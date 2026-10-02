# Deploys

## Pipeline
Every merge to main builds an image, runs the test suite and deploys to staging
automatically. Production needs a human to approve the promotion step; nothing reaches
production straight from a merge.

## Rollback
Rolling back is promoting the previous image, and it takes about 90 seconds. Prefer it over
a forward fix during an incident: the fix can be written calmly once traffic is healthy.

## Freeze windows
There is a deploy freeze from the Thursday before a public holiday until the following
Monday, and for the last two weeks of December. Emergency fixes during a freeze need an
incident number.

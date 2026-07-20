# Test audio

Generated locally with macOS `say` (offline) + `afconvert`/`ffmpeg`. Drag any of
these into the app to test transcription. (Transcription needs a model downloaded
first — pick one in the **Models** view; `large-v3-turbo` is the default.)

| File | Voice / accent | Length | What it tests |
|------|----------------|--------|---------------|
| `en-us-short.m4a` | Samantha (US) | 13s | Quick end-to-end, m4a |
| `en-us-short.mp3` | Samantha (US) | 13s | mp3 decode path |
| `en-uk-medium.m4a` | Daniel (UK) | 23s | British accent, sentence boundaries |
| `en-uk-medium-noisy.m4a` | Daniel (UK) + pink noise | 23s | Robustness to background noise |
| `en-au-long.m4a` | Karen (AU) | 76s | Longer multi-paragraph, endurance |

## Ground-truth transcripts (what was spoken)

### en-us-short
> Welcome to Transcriptor. This is a short test recording. Segment one: the
> quick brown fox jumps over the lazy dog. Segment two: testing timestamps at
> three seconds and seven seconds. End of short test.

### en-uk-medium
> Welcome back to the show. Today we are talking about on-device machine
> learning and why privacy matters. Everything you record here stays on your
> own machine. Nothing is ever uploaded, capped, or truncated. Even a four
> hour recording transcribes end to end. And the timestamps line up exactly
> with your video. That is the whole point: accurate, private, offline
> transcription.

### en-uk-medium-noisy
Same text as `en-uk-medium`, mixed with low-level pink noise (~6% amplitude).

### en-au-long
> This is a longer test recording to check how Transcriptor handles a
> multi-paragraph file. Welcome to the offline transcription podcast, episode
> one. In this episode we explore what it means to run a speech model entirely
> on your own hardware. First, let us talk about privacy. When audio never
> leaves your machine, there is no risk of a cloud provider retaining your
> recordings, training on your data, or leaking it in a breach. The file you
> drop is the file that gets transcribed, and the transcript lives only on your
> disk. Second, accuracy. Modern speech models transcribe over ninety nine
> languages and can auto detect the spoken language from the first few seconds
> of audio. They emit frame accurate timestamps, which means your subtitles
> stay in sync with the video, second by second, even for a four hour lecture.
> Third, reliability. There is no monthly quota, no per minute billing, and no
> file length cap. You can transcribe an entire conference, walk away, and come
> back to a finished transcript. Finally, a note about trust. Open source
> means you can read every line of code that touches your audio. No telemetry,
> no analytics, no phone home. That is the promise of on device computing, and
> that is why we built Transcriptor. Thank you for listening.

## Regenerating

```bash
cd samples
# say + afconvert + ffmpeg produce these; rerun the generator script if needed.
```
import {Video} from '@remotion/media';
import {AbsoluteFill, Composition, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import manifest from './ai-video-manifest.json';

export type AiClip = {id: string; src: string; fps: number; from: number; durationInFrames: number};
const clips: AiClip[] = manifest;

const Clip: React.FC<{clip: AiClip}> = ({clip}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: interpolate(frame,
    [0, 5, clip.durationInFrames - 6, clip.durationInFrames - 1], [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
    <Video src={staticFile(clip.src)} muted objectFit="contain" style={{width: '100%', height: '100%'}} />
  </AbsoluteFill>;
};

// Reuse inside a speaking-video composition; its original voice remains underneath.
// Generated MP4s are opaque. This is a cutaway layer, not automatic person matting.
export const AiVideoLayer: React.FC<{items?: AiClip[]}> = ({items = clips}) => <>
  {items.map(clip => <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames}>
    <Clip clip={clip}/>
  </Sequence>)}
</>;

const Preview: React.FC = () => <AbsoluteFill style={{backgroundColor: '#10121a'}}>
  <AiVideoLayer/>
  {clips.length === 0 ? <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', color: '#eee', fontSize: 42, fontFamily: 'Arial', textAlign: 'center', padding: 100}}>
    Nenhum clipe importado.<br/>A prévia aparece aqui após geração e download.
  </AbsoluteFill> : null}
</AbsoluteFill>;

export const CompositionCinematico: React.FC = () => <Composition id="VideoIACinematico" component={Preview}
  width={1080} height={1920} fps={clips[0]?.fps ?? 30}
  durationInFrames={Math.max(150, ...clips.map(c => c.from + c.durationInFrames))}/>;

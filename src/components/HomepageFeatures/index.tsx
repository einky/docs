import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
  icon: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'E-Ink Display',
    icon: '🖥️',
    description: (
      <>
        Built around a 3.97" GooDisplay e-ink panel (800×480px). Zero blue light,
        minimal battery consumption, and a distraction-free reading experience.
      </>
    ),
  },
  {
    title: 'Ren\'Py Compatible',
    icon: '📖',
    description: (
      <>
        Runs a modified Ren'Py engine headless under Xvfb. Frames are captured,
        dithered via Floyd-Steinberg, and pushed to the panel over SPI.
      </>
    ),
  },
  {
    title: 'Portable & Open',
    icon: '🎮',
    description: (
      <>
        Powered by a Raspberry Pi Zero 2W with a 5000mAh battery, 7 GPIO buttons,
        and a custom enclosure. Fully open-source under the MIT license.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <div style={{fontSize: '3rem', marginBottom: '1rem'}}>{icon}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

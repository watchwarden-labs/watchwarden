import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function ThemeCompare({ dark, light, alt }) {
  const darkUrl = useBaseUrl(dark);
  const lightUrl = useBaseUrl(light);

  return (
    <BrowserOnly fallback={<img src={darkUrl} alt={alt} style={{ width: '100%', borderRadius: '8px' }} />}>
      {() => {
        require('img-comparison-slider');
        return (
          <div style={{ marginBottom: '16px' }}>
            <img-comparison-slider
              style={{
                width: '100%',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'block',
                '--divider-width': '2px',
                '--divider-color': '#4F8EF7',
                '--handle-opacity': '0.9',
              }}
            >
              <img slot="first" src={darkUrl} alt={`${alt} — dark`} width="100%" />
              <img slot="second" src={lightUrl} alt={`${alt} — light`} width="100%" />
            </img-comparison-slider>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: 'var(--ifm-color-emphasis-600)',
              marginTop: '4px',
              padding: '0 4px',
            }}>
              <span>Dark</span>
              <span>Light</span>
            </div>
          </div>
        );
      }}
    </BrowserOnly>
  );
}

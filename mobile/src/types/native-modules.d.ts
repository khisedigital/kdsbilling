declare module 'react-native-thermal-receipt-printer' {
  export const BLEPrinter: {
    init: () => Promise<void>;
    getDeviceList: () => Promise<Array<Record<string, string>>>;
    connectPrinter: (address: string) => Promise<void>;
    closeConn: () => Promise<void>;
    printText: (text: string, opts?: object) => Promise<void>;
  };
  export const NetPrinter: {
    init: () => Promise<void>;
    connectPrinter: (host: string, port: number) => Promise<void>;
    closeConn: () => Promise<void>;
    printText: (text: string, opts?: object) => Promise<void>;
  };
}

declare module 'react-native-vector-icons/MaterialCommunityIcons' {
  import type { ComponentType } from 'react';
  import type { TextProps } from 'react-native';

  interface IconProps extends TextProps {
    name: string;
    size?: number;
    color?: string;
  }

  const Icon: ComponentType<IconProps>;
  export default Icon;
}

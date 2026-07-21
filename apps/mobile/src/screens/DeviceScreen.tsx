import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Color, Radius, Shadow, Space, Type } from '@/constants/design';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Haptics } from '@/lib/haptics';
import { fetchBootstrap, humanizeMobileError, listDevices, revokeDevice } from '@/lib/api';
import { clearMobileSession, loadMobileSession } from '@/lib/storage';
import type { MobileSession } from '@/lib/types';

const experienceVersion = '中文验收版 1.0.8';

function labelPlatform(platform?: string) {
  if (!platform) return '未知平台';
  if (platform === 'ios') return 'iPhone';
  if (platform === 'android') return '安卓';
  if (platform === 'web') return '网页入口';
  return '未知平台';
}

function labelStatus(status?: string) {
  if (!status) return '未确认';
  if (status === 'active') return '已信任';
  if (status === 'revoked') return '已撤销';
  if (status === 'pending') return '等待中';
  return '未识别状态';
}

function labelSyncModel(model?: string) {
  if (!model) return 'Mac 主源，在线写入，离线只读';
  if (model === 'mac_primary_online_write_offline_readonly') return 'Mac 主源，在线写入，离线只读';
  return 'Mac 主源，同步策略待确认';
}

function labelChannel(channel?: string) {
  if (!channel) return '-';
  if (channel === 'preview') return '内测预览';
  if (channel === 'production') return '正式发布';
  if (channel === 'development') return '开发调试';
  return channel;
}

function labelDistribution(value?: string) {
  if (!value) return '-';
  if (value === 'ios-simulator-first') return 'iOS 模拟器优先';
  if (value === 'android-preview') return '安卓预览安装包';
  if (value === 'testflight') return '苹果内测';
  if (value === 'internal') return '内部安装包';
  if (value === 'store') return '应用商店';
  return value;
}

export default function DeviceScreenImpl() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loading, setLoading] = useState(true);
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const nativeBuild =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber || '1'
      : String(Constants.expoConfig?.android?.versionCode || 1);
  const installLabel =
    Platform.OS === 'web'
      ? `iPhone 网页应用 · ${appVersion}`
      : Platform.OS === 'ios'
        ? `苹果内测包 · ${appVersion} (${nativeBuild})`
        : `安卓内测包 · ${appVersion} (${nativeBuild})`;

  useEffect(() => {
    let active = true;
    loadMobileSession()
      .then((stored) => active && setSession(stored))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const devicesQuery = useQuery({
    queryKey: ['mobile-devices', session?.serverUrl, session?.device.id],
    enabled: Boolean(session),
    queryFn: () => listDevices(session as MobileSession, setSession),
  });

  const bootstrapQuery = useQuery({
    queryKey: ['mobile-bootstrap-contract', session?.serverUrl, session?.device.id],
    enabled: Boolean(session),
    queryFn: () => fetchBootstrap(session as MobileSession, setSession),
  });
  const autoTranscriptionReady = Boolean(
    bootstrapQuery.data?.featureFlags?.voiceAutoTranscription ||
      bootstrapQuery.data?.mobile.nativeCapabilities?.automaticTranscription,
  );
  const autoTranscriptionLabel = bootstrapQuery.isFetching ? '检测中' : autoTranscriptionReady ? '已配置' : '未配置';

  const revokeMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      if (!session) throw new Error('not_paired');
      return revokeDevice(session, deviceId, setSession);
    },
    onSuccess: async (_, deviceId) => {
      Haptics.success();
      if (session?.device.id === deviceId) {
        await clearMobileSession();
        setSession(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
    },
    onError: () => Haptics.error(),
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={Color.primary} />
          <Text style={[Type.body, { color: Color.inkFaint }]}>正在读取设备状态…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.center}>
          <EmptyState
            icon="·"
            title="尚未配对"
            description="回到记录页，输入 Mac 工作台地址和 6 位配对码。配对前不会保存任何桌面数据。"
            tone="muted"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[Type.microBold, { color: Color.primary, letterSpacing: 0.5 }]}>设备与安全</Text>
          <Text style={[Type.displaySm, { color: Color.ink, marginTop: 2 }]}>
            {session.device.name || 'OpenClaw 随身分身'}
          </Text>
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: 4 }]}>{session.serverUrl}</Text>
          <View style={styles.versionBadge}>
            <Text style={[Type.captionBold, { color: Color.primary }]}>{experienceVersion}</Text>
          </View>
          <View style={styles.repairAction}>
            <Button
              label="重新配对"
              tone="secondary"
              size="sm"
              onPress={async () => {
                Haptics.success();
                await clearMobileSession();
                setSession(null);
              }}
            />
          </View>
        </View>

        <Panel title="中文交互验收">
          <InfoRow label="界面语言" value="中文为默认交互语言" />
          <InfoRow label="首屏任务" value="连接 Mac，进入今日记录" />
          <InfoRow label="数据边界" value="Mac 主源，离线只读" />
          <InfoRow label="更新方式" value={bootstrapQuery.data?.mobile.nativeUpdateRequired ? '需要新版安装包' : '可通过 OTA 更新页面'} />
        </Panel>

        <Panel title="本机信任">
          <InfoRow label="设备状态" value={labelStatus(session.device.status)} />
          <InfoRow label="平台" value={labelPlatform(session.device.platform)} />
          <InfoRow label="安装方式" value={installLabel} />
          <InfoRow label="访问令牌到期" value={shortDateTime(session.accessExpiresAt)} />
          <InfoRow label="刷新令牌到期" value={shortDateTime(session.refreshExpiresAt)} />
        </Panel>

        <Panel title="版本与同步契约">
          {bootstrapQuery.error ? (
            <Text style={[Type.bodySm, { color: Color.dangerInk }]}>
              {humanizeMobileError(
                bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : String(bootstrapQuery.error),
              )}
            </Text>
          ) : null}
          <InfoRow label="接口版本" value={bootstrapQuery.data?.mobile.apiVersion || '-'} />
          <InfoRow label="最低可用版本" value={bootstrapQuery.data?.mobile.minSupportedAppVersion || '-'} />
          <InfoRow label="最新应用版本" value={bootstrapQuery.data?.mobile.latestAppVersion || '-'} />
          <InfoRow label="安卓包名" value={bootstrapQuery.data?.mobile.packageName || '-'} />
          <InfoRow label="安卓版本号" value={String(bootstrapQuery.data?.mobile.latestAndroidVersionCode || '-')} />
          <InfoRow label="iPhone 包名" value={bootstrapQuery.data?.mobile.iosBundleIdentifier || '-'} />
          <InfoRow
            label="苹果内测版本"
            value={`${bootstrapQuery.data?.mobile.latestIosAppVersion || '-'} (${bootstrapQuery.data?.mobile.latestIosBuildNumber || '-'})`}
          />
          <InfoRow
            label="原生更新"
            value={bootstrapQuery.data?.mobile.nativeUpdateRequired ? '需要新版安装包' : '可在线更新'}
          />
          <InfoRow label="分发方式" value={labelDistribution(bootstrapQuery.data?.mobile.distribution)} />
          <InfoRow label="更新通道" value={labelChannel(bootstrapQuery.data?.mobile.updateChannel)} />
          <InfoRow label="同步模型" value={labelSyncModel(bootstrapQuery.data?.mobile.syncModel)} />
          <InfoRow label="构建版本" value={bootstrapQuery.data?.mobile.buildSha || '-'} />
        </Panel>

        <Panel title="系统能力">
          <InfoRow label="生物识别" value="本轮不启用" />
          <InfoRow label="通知权限" value="本轮不启用" />
          <InfoRow
            label="语音录音"
            value={bootstrapQuery.data?.mobile.nativeCapabilities?.audioRecording ? '已进入新版包' : '未启用'}
          />
          <InfoRow label="自动转写" value={autoTranscriptionLabel} />
          <Text style={[Type.bodySm, { color: Color.inkFaint, marginTop: Space.xs }]}>
            当前先验证显式录音、转写文本写回、对话和审批；通知和生物识别在稳定后再恢复。
          </Text>
        </Panel>

        <Panel
          title="已配对设备"
          trailing={(devicesQuery.data?.devices.length || 0) + ' 台'}
        >
          {devicesQuery.error ? (
            <Text style={[Type.bodySm, { color: Color.dangerInk, marginBottom: Space.sm }]}>
              {humanizeMobileError(
                devicesQuery.error instanceof Error ? devicesQuery.error.message : String(devicesQuery.error),
              )}
            </Text>
          ) : null}
          {(devicesQuery.data?.devices || []).length === 0 ? (
            <Text style={[Type.bodySm, { color: Color.inkFaint, textAlign: 'center', paddingVertical: Space.lg }]}>
              当前只有本机一台设备。
            </Text>
          ) : (
            (devicesQuery.data?.devices || []).map((device) => (
              <View key={device.id} style={styles.deviceRow}>
                <View style={styles.deviceMain}>
                  <Text style={[Type.h3, { color: Color.ink }]}>{device.name || device.id}</Text>
                  <Text style={[Type.bodySm, { color: Color.inkFaint, marginTop: 2 }]}>
                    {labelPlatform(device.platform)} · {labelStatus(device.status)} · 最后在线 {shortDateTime(device.lastSeenAt)}
                  </Text>
                </View>
                {device.status === 'active' ? (
                  <Button
                    label="撤销"
                    tone="danger"
                    size="sm"
                    onPress={() => {
                      Haptics.warn();
                      revokeMutation.mutate(device.id);
                    }}
                  />
                ) : null}
              </View>
            ))
          )}
        </Panel>

        <Panel title="退出">
          <Text style={[Type.bodySm, { color: Color.inkMuted, marginBottom: Space.md }]}>
            本操作只清除手机本地的访问令牌。要彻底阻断，请同时在 Mac 工作台撤销设备授权。
          </Text>
          <Button
            label="清除本机登录"
            tone="secondary"
            fullWidth
            onPress={async () => {
              Haptics.success();
              await clearMobileSession();
              setSession(null);
            }}
          />
        </Panel>

        <Text style={[Type.micro, { color: Color.inkFaint, textAlign: 'center', marginTop: Space.md }]}>
          OpenClaw 随身分身 · {appVersion} ({nativeBuild})
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- 子组件 ---------- */

function Panel({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={[Type.h2, { color: Color.ink }]}>{title}</Text>
        {trailing ? <Text style={[Type.captionBold, { color: Color.inkFaint }]}>{trailing}</Text> : null}
      </View>
      <View style={{ gap: 0 }}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[Type.body, { color: Color.inkMuted, fontWeight: '700' }]}>{label}</Text>
      <Text style={[Type.body, { color: Color.ink, textAlign: 'right', flex: 1, marginLeft: Space.md }]}>
        {value || '-'}
      </Text>
    </View>
  );
}

function shortDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------- 样式 ---------- */

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: Color.surfaceSubtle,
  },
  content: {
    padding: Space.lg,
    paddingBottom: 120,
    gap: Space.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  header: {
    gap: 0,
    marginBottom: Space.xs,
  },
  versionBadge: {
    alignSelf: 'flex-start',
    marginTop: Space.md,
    backgroundColor: Color.primarySofter,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
  },
  repairAction: {
    alignSelf: 'flex-start',
    marginTop: Space.sm,
  },
  panel: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.sm,
    ...Shadow.sm,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  deviceMain: {
    flex: 1,
  },
});

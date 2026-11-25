import { useFocusEffect } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Platform, View } from 'react-native'
import { useMMKVBoolean, useMMKVNumber } from 'react-native-mmkv'
import Animated, { Easing, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import HorizontalSelector from '@components/input/HorizontalSelector'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedTextInput from '@components/input/ThemedTextInput'
import ThemedSwitch from '@components/input/ThemedSwitch'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { AppSettings, Global } from '@lib/constants/GlobalValues'
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { KV } from '@lib/engine/Local/Model'
import useBackendDevices from '@lib/hooks/BackendDevices'
import { Logger } from '@lib/state/Logger'
import { readableFileSize } from '@lib/utils/File'

type ModelSettingsProp = {
    modelImporting: boolean
    modelLoading: boolean
    setModelLoading: (loading: boolean) => void
    exit: () => void
}

const deviceLabels = { GPUOpenCL: 'OpenCL', HTP0: 'Hexagon', CPU: 'CPU' }

// llama.cpp receives n_ctx as a native integer. This removes the app's old
// 32K UI cap while avoiding values that would overflow a signed 32-bit API.
const MAX_CONTEXT_LENGTH = 2_147_483_647
const MIN_CONTEXT_LENGTH = 128

const ModelSettings: React.FC<ModelSettingsProp> = ({
    modelImporting,
    modelLoading,
    setModelLoading,
    exit,
}) => {
    const { t } = useTranslation()
    const { config, setConfig } = Llama.useLlamaPreferencesStore(
        useShallow((state) => ({
            config: state.config,
            setConfig: state.setConfiguration,
        }))
    )

    const { loadedModel, loadedMmproj, loadedContextLength, unloadModel, loadModel, loadMmproj } =
        Llama.useLlamaModelStore(
            useShallow((state) => ({
                loadedModel: state.model,
                loadedMmproj: state.mmproj,
                loadedContextLength: state.loadedContextLength,
                unloadModel: state.unload,
                loadModel: state.load,
                loadMmproj: state.loadMmproj,
            }))
        )

    const applyContextSettings = async () => {
        if (!loadedModel || modelLoading || modelImporting) return

        setModelLoading(true)
        try {
            const model = loadedModel
            const mmproj = loadedMmproj
            const requestedContextLength = config.context_length

            await unloadModel()
            await loadModel(model)

            const reloadedState = Llama.useLlamaModelStore.getState()
            if (
                !reloadedState.context ||
                reloadedState.loadedContextLength !== requestedContextLength
            ) {
                Logger.errorToast(
                    '模型未能以新的上下文长度加载',
                    `Requested n_ctx=${requestedContextLength}; loaded n_ctx=${reloadedState.loadedContextLength ?? 'none'}`
                )
                return
            }

            if (mmproj) await loadMmproj(mmproj)

            Logger.info(`Context length applied: ${reloadedState.loadedContextLength}`)
        } catch (error) {
            Logger.errorToast('应用上下文长度失败', error)
        } finally {
            setModelLoading(false)
        }
    }

    const contextSettingsChanged =
        !!loadedModel && loadedContextLength !== config.context_length

    const devices = useBackendDevices()

    const [saveKV, setSaveKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
    const [autoloadLocal, setAutoloadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)
    const [threadCount] = useMMKVNumber(Global.CPUThreads)

    const [kvSize, setKVSize] = useState(0)
    const [contextLengthInput, setContextLengthInput] = useState(
        String(config?.context_length ?? 4096)
    )

    useEffect(() => {
        setContextLengthInput(String(config?.context_length ?? 4096))
    }, [config?.context_length])

    const updateContextLength = (rawValue: string) => {
        // Keep the persisted setting in sync with every valid edit so the
        // Apply button reacts immediately instead of waiting for blur/submit.
        setContextLengthInput(rawValue)
        const value = Number(rawValue)
        if (
            /^\d+$/.test(rawValue) &&
            Number.isSafeInteger(value) &&
            value >= MIN_CONTEXT_LENGTH &&
            value <= MAX_CONTEXT_LENGTH
        ) {
            setConfig({ ...config, context_length: value })
        }
    }

    const commitContextLength = () => {
        const value = Number(contextLengthInput)
        if (
            !/^\d+$/.test(contextLengthInput) ||
            !Number.isSafeInteger(value) ||
            value < MIN_CONTEXT_LENGTH ||
            value > MAX_CONTEXT_LENGTH
        ) {
            setContextLengthInput(String(config.context_length))
            return
        }
        setConfig({ ...config, context_length: value })
    }

    const getKVSize = async () => {
        const size = await KV.getKVSize()
        setKVSize(size)
    }

    useEffect(() => {
        KV.getKVSize().then(setKVSize)
    }, [])

    const backAction = () => {
        exit()
        return true
    }

    useFocusEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', backAction)
        return () => handler.remove()
    })

    const handleDeleteKV = () => {
        Alert.alert({
            title: t('model.alert.deletekv.title'),
            description: t('model.alert.deletekv.description', { size: readableFileSize(kvSize) }),
            buttons: [
                { label: t('common.actions.delete') },
                {
                    label: t('model.alert.deletekv.title'),
                    onPress: async () => {
                        await KV.deleteKV()
                        Logger.info(t('model.toast.deletekv'))
                        getKVSize()
                    },
                    type: 'warning',
                },
            ],
        })
    }

    return (
        <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            entering={SlideInRight.easing(Easing.inOut(Easing.cubic))}
            exiting={SlideOutRight.easing(Easing.inOut(Easing.cubic))}>
            <SectionTitle>{t('model.settings.cpu')}</SectionTitle>
            <View style={{ marginTop: 16 }} />
            {config && (
                <>
                    <ThemedTextInput
                        label={`${t('model.maxcontext')} (tokens)`}
                        value={contextLengthInput}
                        onChangeText={updateContextLength}
                        onEndEditing={commitContextLength}
                        onSubmitEditing={commitContextLength}
                        keyboardType="number-pad"
                        returnKeyType="done"
                        placeholder="4096"
                        editable={!modelImporting && !modelLoading}
                    />
                    {contextSettingsChanged && (
                        <ThemedButton
                            buttonStyle={{ marginTop: 8 }}
                            label={t('model.applyContext')}
                            onPress={applyContextSettings}
                            disabled={modelImporting || modelLoading}
                        />
                    )}
                    <ThemedSlider
                        label={t('model.threads')}
                        value={config.threads}
                        onValueChange={(value) => setConfig({ ...config, threads: value })}
                        min={1}
                        max={threadCount ?? 8}
                        step={1}
                        disabled={modelImporting || modelLoading}
                    />

                    <ThemedSlider
                        label={t('model.batch')}
                        value={config.batch}
                        onValueChange={(value) => setConfig({ ...config, batch: value })}
                        min={16}
                        max={1024}
                        step={16}
                        disabled={modelImporting || modelLoading}
                    />

                    {/* Note: llama.rn does not have any Android gpu acceleration */}
                    {(Platform.OS === 'ios' || devices.length > 1) && (
                        <ThemedSlider
                            label={t('model.gpulayers')}
                            value={config.gpu_layers}
                            onValueChange={(value) => setConfig({ ...config, gpu_layers: value })}
                            min={0}
                            max={100}
                            step={1}
                            disabled={modelImporting || modelLoading}
                        />
                    )}

                    <ThemedSwitch
                        label={t('model.contextshift')}
                        value={config.ctx_shift}
                        onChangeValue={(value) => {
                            setConfig({ ...config, ctx_shift: value })
                        }}
                    />

                    {devices.length > 1 && (
                        <HorizontalSelector
                            style={{ paddingBottom: 12 }}
                            label={t('model.backenddev')}
                            values={devices.map((item) => ({
                                label: deviceLabels[item as keyof typeof deviceLabels] ?? item,
                                value: item,
                            }))}
                            selected={config.devices?.[0]}
                            onPress={(value) => {
                                const devices = value === 'CPU' ? [value] : [value, 'CPU']
                                setConfig({ ...config, devices })
                            }}
                        />
                    )}
                </>
            )}
            <SectionTitle>{t('model.settings.advanced')}</SectionTitle>
            <ThemedSwitch
                label={t('model.modelnamechat')}
                value={showModelInChat}
                onChangeValue={setShowModelInChat}
            />
            <ThemedSwitch
                label={t('model.autoload')}
                value={autoloadLocal}
                onChangeValue={setAutoloadLocal}
            />
            <ThemedSwitch
                label={t('model.savekv')}
                value={saveKV}
                onChangeValue={setSaveKV}
                description={saveKV ? '' : t('model.savekvdesc')}
            />
            {saveKV && (
                <ThemedButton
                    buttonStyle={{ marginTop: 8 }}
                    label={t('model.purgekv', { size: readableFileSize(kvSize) })}
                    onPress={handleDeleteKV}
                    variant={kvSize === 0 ? 'disabled' : 'critical'}
                />
            )}
        </Animated.ScrollView>
    )
}

export default ModelSettings

import { attachModelWheelRotation, rotateModelFromWheel } from '@n-apt/three-d/modelWheelRotation';

describe('model wheel rotation', () => {
  test('rotates horizontally from vertical mouse-wheel movement', () => {
    const controls = {
      getAzimuthalAngle: jest.fn(() => 0.5),
      setAzimuthalAngle: jest.fn(),
      update: jest.fn(),
    };
    const event = {
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
    };

    expect(rotateModelFromWheel(controls, event as unknown as WheelEvent)).toBe(true);
    expect(controls.setAzimuthalAngle).toHaveBeenCalledWith(1.5);
    expect(controls.update).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  test('uses horizontal trackpad scrolling and lets pinch-to-zoom pass through', () => {
    const controls = {
      getAzimuthalAngle: jest.fn(() => 0),
      setAzimuthalAngle: jest.fn(),
      update: jest.fn(),
    };
    const horizontalScroll = {
      deltaX: -50,
      deltaY: 12,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
    };

    expect(rotateModelFromWheel(controls, horizontalScroll as unknown as WheelEvent)).toBe(true);
    expect(controls.setAzimuthalAngle).toHaveBeenCalledWith(-0.5);

    const pinch = { ...horizontalScroll, ctrlKey: true, preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
    expect(rotateModelFromWheel(controls, pinch as unknown as WheelEvent)).toBe(false);
    expect(pinch.preventDefault).not.toHaveBeenCalled();
    expect(pinch.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(controls.update).toHaveBeenCalledTimes(1);
  });

  test('intercepts ordinary wheel events before OrbitControls but leaves pinch events for zoom', () => {
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    wrapper.append(canvas);
    const controls = {
      getAzimuthalAngle: jest.fn(() => 0),
      setAzimuthalAngle: jest.fn(),
      update: jest.fn(),
    };
    const orbitWheelHandler = jest.fn();
    canvas.addEventListener('wheel', orbitWheelHandler);
    const detach = attachModelWheelRotation(canvas, () => controls);

    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    expect(controls.setAzimuthalAngle).toHaveBeenCalled();
    expect(orbitWheelHandler).not.toHaveBeenCalled();

    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, ctrlKey: true }));
    expect(orbitWheelHandler).toHaveBeenCalledTimes(1);
    detach();
  });
});
